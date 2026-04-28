"""Genomics — V0 stub variant call. Returns a small canned annotation set
so the TS side can demo the round-trip; real PyVCF + VEP-lite arrives in V1.
"""

from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

# Canonical HGVS-style variant pattern (very loose). Real validation
# happens in V1 with biopython/pyvcf.
HGVS_RE = re.compile(r"^(?:NM_\d+\.\d+|chr\d+|chrX|chrY|chrM):.+$", re.IGNORECASE)


class VariantCallRequest(BaseModel):
    variant: str = Field(..., description="HGVS-style variant id, e.g. NM_007294.4:c.5266dupC")
    consequencePreference: Literal["coding", "splicing", "regulatory", "any"] = "coding"


class VariantAnnotation(BaseModel):
    variant: str
    geneSymbol: str
    consequence: str
    clinicalSignificance: Literal["benign", "likely_benign", "vus", "likely_pathogenic", "pathogenic", "unknown"]
    cadd: float | None
    hgvsP: str | None
    notes: list[str]


# Tiny canned annotation table — covers a handful of high-value cancer
# variants for the demo. Real lookup wires VEP / Ensembl / ClinVar in V1.
CANNED: dict[str, VariantAnnotation] = {
    "NM_007294.4:c.5266dupC": VariantAnnotation(
        variant="NM_007294.4:c.5266dupC",
        geneSymbol="BRCA1",
        consequence="frameshift_variant",
        clinicalSignificance="pathogenic",
        cadd=33.0,
        hgvsP="p.Gln1756Profs*74",
        notes=["Founder mutation in Ashkenazi Jewish populations.", "Lifetime breast cancer risk ~70%."],
    ),
    "NM_000059.4:c.5946delT": VariantAnnotation(
        variant="NM_000059.4:c.5946delT",
        geneSymbol="BRCA2",
        consequence="frameshift_variant",
        clinicalSignificance="pathogenic",
        cadd=32.0,
        hgvsP="p.Ser1982Argfs*22",
        notes=["Ashkenazi founder.", "Increased ovarian + male breast cancer risk."],
    ),
    "NM_000546.6:c.524G>A": VariantAnnotation(
        variant="NM_000546.6:c.524G>A",
        geneSymbol="TP53",
        consequence="missense_variant",
        clinicalSignificance="likely_pathogenic",
        cadd=27.0,
        hgvsP="p.Arg175His",
        notes=["Hotspot mutation.", "Loss-of-function in tumour suppressor."],
    ),
}


@router.post("/variant-call", response_model=VariantAnnotation)
def variant_call(req: VariantCallRequest) -> VariantAnnotation:
    """Annotate a variant. V0 returns a canned annotation if known, else
    a stub VUS classification with shape-only guesses. V1 will plug in
    the Ensembl VEP REST API + a local CADD lookup."""

    canned = CANNED.get(req.variant)
    if canned:
        return canned

    if not HGVS_RE.match(req.variant):
        return VariantAnnotation(
            variant=req.variant,
            geneSymbol="UNKNOWN",
            consequence="unknown",
            clinicalSignificance="unknown",
            cadd=None,
            hgvsP=None,
            notes=["Variant identifier does not match a recognised HGVS pattern."],
        )

    return VariantAnnotation(
        variant=req.variant,
        geneSymbol="UNKNOWN",
        consequence="not_annotated",
        clinicalSignificance="vus",
        cadd=None,
        hgvsP=None,
        notes=[
            "V0 stub — no live VEP lookup. Returning VUS as a safe default.",
            "Set GENOMICS_BACKEND=vep in V1 to enable Ensembl REST resolution.",
        ],
    )
