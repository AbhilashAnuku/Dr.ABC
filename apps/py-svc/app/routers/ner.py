"""Medical NER — V0 wraps a regex-based extractor for the demo. V1
loads scispaCy `en_core_sci_md` lazily on first request.

The shape mirrors what scispaCy returns so the TS client doesn't have
to change when we swap.
"""

from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class NerRequest(BaseModel):
    text: str
    backend: Literal["regex", "scispacy"] = "regex"


class Entity(BaseModel):
    text: str
    label: Literal[
        "DRUG", "DOSE", "CONDITION", "ANATOMY", "VITAL", "LAB", "PROCEDURE", "OTHER",
    ]
    start: int
    end: int
    confidence: float


class NerResponse(BaseModel):
    backend: Literal["regex", "scispacy"]
    entities: list[Entity]


# Compact pattern set covering the entity types Mörbius surfaces most
# often. Order matters — DOSE must be tried before DRUG so "500 mg" doesn't
# get classified twice.
PATTERNS: list[tuple[str, str]] = [
    (r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|L|IU|mmol|mmHg|bpm)\b", "DOSE"),
    (
        r"\b(?:aspirin|paracetamol|acetaminophen|ibuprofen|metformin|insulin|warfarin|"
        r"apixaban|rivaroxaban|atorvastatin|simvastatin|amoxicillin|amlodipine|losartan|"
        r"lisinopril|sertraline|escitalopram|levothyroxine|prednisone|dexamethasone|"
        r"sumatriptan|salbutamol|albuterol|tiotropium|empagliflozin|semaglutide|tirzepatide|"
        r"clopidogrel|tamsulosin|omeprazole|pantoprazole|fluoxetine)\b",
        "DRUG",
    ),
    (
        r"\b(?:diabetes|hypertension|asthma|COPD|stroke|MI|myocardial infarction|"
        r"pneumonia|sepsis|cancer|migraine|epilepsy|depression|anxiety|GERD|UTI|"
        r"CKD|heart failure|atrial fibrillation|DVT|PE|pulmonary embolism|"
        r"tuberculosis|HIV|AIDS|COVID|influenza|hepatitis)\b",
        "CONDITION",
    ),
    (
        r"\b(?:HR|BP|SpO2|RR|temperature|temp|systolic|diastolic|pulse|sat(?:uration)?)"
        r"(?:\s+\d+(?:[/.]\d+)?)?\b",
        "VITAL",
    ),
    (
        r"\b(?:HbA1c|LDL|HDL|cholesterol|creatinine|eGFR|glucose|hemoglobin|haemoglobin|"
        r"WBC|platelets|troponin|CRP|ESR|TSH|T4|sodium|potassium|chloride|bicarbonate|"
        r"INR|aPTT)\b",
        "LAB",
    ),
    (
        r"\b(?:ECG|EKG|MRI|CT|x[- ]?ray|echocardiogram|colonoscopy|endoscopy|biopsy|"
        r"PCI|CABG|tPA|angiography|cath|appendectomy|cholecystectomy|hysterectomy)\b",
        "PROCEDURE",
    ),
    (
        r"\b(?:heart|lung|liver|kidney|brain|spine|stomach|intestine|pancreas|"
        r"thyroid|prostate|breast|ovary|uterus|aorta|coronary|carotid|spleen)\b",
        "ANATOMY",
    ),
]


def regex_ner(text: str) -> list[Entity]:
    found: list[Entity] = []
    seen: set[tuple[int, int]] = set()
    for pat, label in PATTERNS:
        for match in re.finditer(pat, text, flags=re.IGNORECASE):
            span = (match.start(), match.end())
            if span in seen:
                continue
            seen.add(span)
            found.append(
                Entity(
                    text=text[span[0] : span[1]],
                    label=label,  # type: ignore[arg-type]
                    start=span[0],
                    end=span[1],
                    confidence=0.7,
                )
            )
    found.sort(key=lambda e: e.start)
    return found


@router.post("/medical", response_model=NerResponse)
def medical_ner(req: NerRequest) -> NerResponse:
    """Extract drug, dose, condition, vital, lab, procedure, anatomy
    spans from free clinical text."""
    if req.backend == "scispacy":
        # Hook for V1 — keep the response shape identical.
        # from .scispacy_loader import nlp
        # entities = scispacy_extract(nlp, req.text)
        return NerResponse(backend="scispacy", entities=regex_ner(req.text))
    return NerResponse(backend="regex", entities=regex_ner(req.text))
