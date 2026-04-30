/**
 * Disease catalogue — 50 conditions across the ICD-10 chapters most
 * frequently surfaced by Mörbius. Each entry is the *educational*
 * version of the entry: short summary, modern first-line treatment,
 * one prevention line, when-to-worry, plus a red-flags list (escalate
 * triggers) and a mimics list (differential pointers a clinician
 * would consider before confirming).
 *
 * The shape is intentionally flat — no nested narrative prose — so
 * the chat engine can splice fields together based on the question
 * shape ("what is X?", "how do I treat X?", "is X serious?").
 *
 * NOT a clinical decision tool. Every chat response that uses these
 * entries appends a clinician-handoff disclaimer, and the orchestrator
 * still owns any actual symptom-triage decision.
 */

export interface DiseaseEntry {
  name: string;
  synonyms?: string[];
  icd10: string;
  specialty: string;
  summary: string;
  treatment: string;
  prevention: string;
  whenToWorry: string;
  redFlags: string[];
  mimics: string[];
}

export const DISEASES: DiseaseEntry[] = [
  // ───────── A — Infectious ─────────
  {
    name: 'COVID-19',
    synonyms: ['covid', 'corona', 'coronavirus', 'sars-cov-2'],
    icd10: 'U07.1',
    specialty: 'Infectious',
    summary:
      'An acute respiratory illness caused by SARS-CoV-2. Most people recover at home in 5–10 days. Vaccination remains the primary defence against severe disease.',
    treatment:
      'Mild: rest, fluids, paracetamol for fever. High-risk patients (over 65, immunocompromised, chronic disease) qualify for nirmatrelvir/ritonavir within 5 days of symptoms. Severe: dexamethasone + tocilizumab + supplemental oxygen.',
    prevention:
      'Stay current with COVID vaccines, mask in high-risk indoor settings, ventilate shared spaces.',
    whenToWorry:
      'Difficulty breathing, persistent chest pain, blue lips, confusion, or oxygen saturation under 92 % on a pulse oximeter — go to ER immediately.',
    redFlags: [
      'SpO₂ < 92 % at rest',
      'Worsening dyspnoea after day 5',
      'Confusion or syncope',
      'Chest pain',
      'Inability to keep fluids down for > 12 h',
    ],
    mimics: [
      'Influenza',
      'RSV',
      'Bacterial pneumonia',
      'Pulmonary embolism',
      'Heart failure decompensation',
    ],
  },
  {
    name: 'Influenza',
    synonyms: ['flu', 'seasonal flu', 'influenza a', 'influenza b'],
    icd10: 'J11',
    specialty: 'Infectious',
    summary:
      'Acute viral respiratory infection from influenza A or B viruses. Sudden onset of fever, body aches, cough, and exhaustion — distinct from a slow-build cold.',
    treatment:
      'Most cases: rest, fluids, paracetamol, isolate. Oseltamivir within 48 h of symptoms shortens illness by ~1 day and is recommended for high-risk groups (pregnant, > 65, chronic disease). Annual vaccination is the cornerstone.',
    prevention:
      'Annual flu shot (the strain mix is updated each year), hand hygiene, mask in crowded indoor settings during flu season.',
    whenToWorry:
      'Difficulty breathing, persistent chest pain, sustained high fever > 39.5 °C beyond day 3, severe weakness — escalate to ER.',
    redFlags: [
      'Dyspnoea',
      'Chest pain',
      'Severe dehydration',
      'Confusion',
      'Symptoms improving then suddenly worsening (bacterial superinfection)',
    ],
    mimics: [
      'COVID-19',
      'RSV',
      'Common cold (rhinovirus)',
      'Bacterial pneumonia',
      'Acute HIV seroconversion',
    ],
  },
  {
    name: 'Urinary Tract Infection',
    synonyms: ['uti', 'cystitis', 'bladder infection', 'urine infection'],
    icd10: 'N39.0',
    specialty: 'Infectious',
    summary:
      'Bacterial infection of the bladder (cystitis) or kidneys (pyelonephritis). Most uncomplicated UTIs in women are caused by E. coli and resolve quickly with antibiotics.',
    treatment:
      'Uncomplicated cystitis: nitrofurantoin 100 mg BID × 5 days or fosfomycin 3 g single dose. Avoid quinolones first-line (FDA black-box). Pyelonephritis: oral ciprofloxacin or IV ceftriaxone if hospitalised.',
    prevention:
      'Hydrate, void after intercourse, wipe front-to-back, avoid prolonged urinary catheters. Cranberry products have weak but non-zero evidence.',
    whenToWorry:
      'Fever, flank pain, vomiting, or pregnancy — these suggest pyelonephritis or complicated UTI and need same-day care.',
    redFlags: [
      'Flank pain or CVA tenderness',
      'Fever > 38.5 °C',
      'Vomiting',
      'Pregnancy',
      'Diabetes with worsening symptoms',
    ],
    mimics: [
      'Vaginitis',
      'Sexually transmitted infection (chlamydia)',
      'Interstitial cystitis',
      'Kidney stones',
      'Pelvic inflammatory disease',
    ],
  },
  {
    name: 'Strep Throat',
    synonyms: ['strep', 'streptococcal pharyngitis', 'sore throat infection', 'gas pharyngitis'],
    icd10: 'J02.0',
    specialty: 'Infectious',
    summary:
      'Pharyngitis caused by group A Streptococcus. Sudden sore throat, fever, tender anterior neck nodes, white tonsillar exudate — usually no cough.',
    treatment:
      'Confirm with rapid strep test before antibiotics. First-line: penicillin V 500 mg BID × 10 days, or amoxicillin once daily. Penicillin allergy: cephalexin or azithromycin.',
    prevention:
      'Hand hygiene, avoid sharing utensils with infected contacts, complete the full antibiotic course to prevent rheumatic fever.',
    whenToWorry:
      'Difficulty swallowing or breathing, drooling, muffled voice (peritonsillar abscess), or rash with strawberry tongue (scarlet fever) — same-day care.',
    redFlags: [
      'Stridor or drooling',
      'Inability to swallow saliva',
      'Trismus (lockjaw)',
      'Unilateral tonsillar bulge',
      'Rash + tongue changes',
    ],
    mimics: [
      'Viral pharyngitis (most common)',
      'Mononucleosis',
      'Gonococcal pharyngitis',
      'Acute HIV',
      'Peritonsillar abscess',
    ],
  },
  {
    name: 'Tuberculosis',
    synonyms: ['tb', 'pulmonary tb', 'consumption'],
    icd10: 'A15',
    specialty: 'Infectious',
    summary:
      'Chronic bacterial infection by Mycobacterium tuberculosis, primarily affecting lungs. Endemic in many regions; latent in ~25 % of the world population.',
    treatment:
      'Active TB: 4-drug RIPE therapy (rifampicin + isoniazid + pyrazinamide + ethambutol) for 2 months, then 4 more months of rifampicin + isoniazid. Drug-resistant TB requires 18+ months of second-line agents.',
    prevention:
      'BCG vaccine in endemic countries, contact tracing, treat latent TB with isoniazid or rifampicin in high-risk patients, ventilate indoor spaces.',
    whenToWorry:
      'Cough > 3 weeks with weight loss, night sweats, blood in sputum (haemoptysis), or contact with active TB — get sputum tested.',
    redFlags: [
      'Haemoptysis',
      'Drenching night sweats',
      'Unintentional weight loss > 5 %',
      'HIV co-infection',
      'Cavitating chest X-ray',
    ],
    mimics: [
      'Lung cancer',
      'Bacterial pneumonia',
      'Fungal infection (histoplasmosis, coccidioidomycosis)',
      'Sarcoidosis',
      'Silicosis',
    ],
  },

  // ───────── B–D — Neoplasms ─────────
  {
    name: 'Breast Cancer',
    synonyms: ['breast tumor', 'breast lump', 'mammary cancer', 'ductal carcinoma'],
    icd10: 'C50',
    specialty: 'Oncology',
    summary:
      'Most common cancer in women globally. Subtype matters: hormone-receptor-positive, HER2-positive, and triple-negative each have distinct treatments and prognoses.',
    treatment:
      'Surgery (lumpectomy or mastectomy) ± sentinel-node biopsy. HR-positive: tamoxifen or aromatase inhibitor for 5–10 years. HER2-positive: trastuzumab + pertuzumab. Adjuvant chemo, radiotherapy, and CDK4/6 inhibitors per stage.',
    prevention:
      'Screening mammography from age 40–50 (regional guidelines vary), maintain healthy weight, limit alcohol, breastfeed if possible, BRCA testing if strong family history.',
    whenToWorry:
      'New breast lump, bloody nipple discharge, skin dimpling or peau d’orange, axillary lymphadenopathy — same-week imaging.',
    redFlags: [
      'Skin retraction or peau d’orange',
      'Bloody unilateral nipple discharge',
      'Hard fixed lump',
      'Axillary lymphadenopathy',
      'Inflammatory breast cancer signs',
    ],
    mimics: ['Fibroadenoma', 'Breast cyst', 'Mastitis', 'Fat necrosis', 'Lipoma'],
  },
  {
    name: 'Colorectal Cancer',
    synonyms: ['colon cancer', 'bowel cancer', 'rectal cancer', 'crc'],
    icd10: 'C18',
    specialty: 'Oncology',
    summary:
      'Adenocarcinoma of the colon or rectum, almost always arising from a precursor adenomatous polyp over 5–15 years. Highly preventable with screening.',
    treatment:
      'Surgical resection ± adjuvant FOLFOX chemo for stage III. Metastatic: oxaliplatin/irinotecan-based regimens, anti-EGFR (cetuximab) if RAS wild-type, immunotherapy if MSI-high.',
    prevention:
      'Colonoscopy every 10 years from age 45–50, FIT testing yearly as alternative, fibre-rich diet, limit red and processed meat, no smoking.',
    whenToWorry:
      'Blood in stool, change in bowel habit > 4 weeks, unexplained weight loss, iron-deficiency anaemia in adults — colonoscopy.',
    redFlags: [
      'Iron-deficiency anaemia in male or post-menopausal female',
      'Rectal bleeding > age 50',
      'Unintentional weight loss',
      'Family history of CRC < 50',
      'Palpable abdominal mass',
    ],
    mimics: [
      'Haemorrhoids',
      'Diverticular disease',
      'Inflammatory bowel disease',
      'Irritable bowel syndrome',
      'Ischaemic colitis',
    ],
  },
  {
    name: 'Melanoma',
    synonyms: ['skin cancer', 'mole cancer', 'malignant melanoma'],
    icd10: 'C43',
    specialty: 'Oncology',
    summary:
      'Aggressive skin cancer arising from melanocytes. Curable when caught early but rapidly fatal once metastatic — modern immunotherapy has changed outcomes dramatically.',
    treatment:
      'Wide local excision (margin = depth-dependent). Sentinel-node biopsy if Breslow > 0.8 mm. Stage III–IV: adjuvant checkpoint inhibitors (nivolumab, pembrolizumab) ± BRAF/MEK inhibitors if BRAF V600E mutation.',
    prevention:
      'Sun protection (SPF 30+, hat, shade), avoid tanning beds, monthly self-skin checks, annual dermatology check if high risk.',
    whenToWorry:
      'A mole that is Asymmetric, has irregular Borders, varied Colours, > 6 mm Diameter, or is Evolving — that is the ABCDE rule. Get it checked.',
    redFlags: [
      'Rapid change in size, shape, or colour',
      'Bleeding or ulcerated mole',
      'Satellite lesions',
      'New nodule on existing mole',
      'Family history of melanoma',
    ],
    mimics: [
      'Seborrheic keratosis',
      'Atypical (dysplastic) naevus',
      'Pigmented basal-cell carcinoma',
      'Blue naevus',
      'Dermatofibroma',
    ],
  },
  {
    name: 'Lung Cancer',
    synonyms: ['lung tumor', 'nsclc', 'sclc', 'bronchogenic carcinoma'],
    icd10: 'C34',
    specialty: 'Oncology',
    summary:
      'Leading cancer cause of death worldwide. Two main groups: non-small-cell (~85 %, includes adenocarcinoma and squamous) and small-cell (aggressive, strongly smoking-linked).',
    treatment:
      'NSCLC: stage I–II surgery; stage III chemo-radiation; stage IV targeted therapy (EGFR, ALK, KRAS-G12C inhibitors) or immunotherapy (pembrolizumab) per PD-L1 status. SCLC: platinum-etoposide + atezolizumab.',
    prevention:
      "Don't smoke, quit if you do, avoid second-hand smoke, test home for radon, screen with low-dose CT if high-risk smoker (USPSTF age 50–80).",
    whenToWorry:
      'Persistent cough > 3 weeks (especially in a smoker), haemoptysis, weight loss, persistent chest pain, recurrent pneumonia — get imaging.',
    redFlags: [
      'Haemoptysis',
      'Hoarseness (laryngeal nerve invasion)',
      'Horner syndrome (Pancoast tumour)',
      'SVC syndrome (face/neck swelling)',
      'Pathological fracture',
    ],
    mimics: [
      'Tuberculosis',
      'Sarcoidosis',
      'Pulmonary nodules from prior infection',
      'Carcinoid tumour',
      'Lung abscess',
    ],
  },

  // ───────── D — Blood ─────────
  {
    name: 'Iron Deficiency Anaemia',
    synonyms: ['anemia', 'low iron', 'low hemoglobin', 'iron deficiency'],
    icd10: 'D50',
    specialty: 'Haematology',
    summary:
      'Reduced red-cell production from inadequate iron stores. The most common nutritional deficiency worldwide, especially in menstruating women, vegetarians, and pregnancy.',
    treatment:
      'Oral ferrous sulfate 325 mg every other day (better absorbed than daily) until ferritin normalises, then 3 more months. IV iron (ferric carboxymaltose) if oral intolerance or rapid replacement needed.',
    prevention:
      'Iron-rich diet (red meat, lentils, dark leafy greens), pair plant iron with vitamin C, treat heavy menstrual bleeding, screen in pregnancy.',
    whenToWorry:
      'Anaemia in an adult man or post-menopausal woman almost always needs GI workup — colorectal cancer must be ruled out.',
    redFlags: [
      'Hb < 7 g/dL with symptoms',
      'Anaemia in adult male',
      'Anaemia post-menopause',
      'Melaena or haematuria',
      'Failure to respond to oral iron',
    ],
    mimics: [
      'Anaemia of chronic disease',
      'Thalassaemia trait',
      'B12 / folate deficiency',
      'Chronic kidney disease anaemia',
      'Myelodysplastic syndrome',
    ],
  },

  // ───────── E — Endocrine / Metabolic ─────────
  {
    name: 'Type 2 Diabetes',
    synonyms: ['diabetes', 'sugar', 'high sugar', 'diabetic', 'dm2', 'type 2'],
    icd10: 'E11',
    specialty: 'Endocrinology',
    summary:
      "A condition where the body becomes resistant to insulin and the pancreas can't keep up, leading to chronically high blood sugar. Often coexists with obesity, hypertension, and dyslipidaemia.",
    treatment:
      'Lifestyle is the foundation: weight loss, Mediterranean or low-carb diet, 150 min/week of exercise. First-line drug is metformin. Modern combos: GLP-1 agonists (semaglutide, tirzepatide) and SGLT2 inhibitors (empagliflozin) — especially if you also have heart or kidney disease.',
    prevention:
      'Maintain a healthy weight, exercise regularly, limit sugary drinks and refined carbs, screen yearly if you have a family history or BMI > 25.',
    whenToWorry:
      'If your blood sugar is over 300 mg/dL with vomiting or confusion (DKA risk), or under 70 mg/dL with sweating and shaking — get help immediately.',
    redFlags: [
      'Glucose > 300 mg/dL with vomiting (DKA)',
      'Severe hypoglycaemia (LOC, seizure)',
      'Foot ulcer with cellulitis',
      'Sudden vision loss',
      'Hyperosmolar symptoms',
    ],
    mimics: [
      'Type 1 diabetes (especially LADA in adults)',
      'Steroid-induced hyperglycaemia',
      'Cushing syndrome',
      'Pancreatic insufficiency',
      'MODY (genetic)',
    ],
  },
  {
    name: 'Hypothyroidism',
    synonyms: ['underactive thyroid', 'low thyroid', 'hashimoto', 'thyroid deficiency'],
    icd10: 'E03',
    specialty: 'Endocrinology',
    summary:
      'Insufficient thyroid hormone, most often from autoimmune Hashimoto thyroiditis. Causes fatigue, weight gain, cold intolerance, dry skin, constipation, and slow thinking.',
    treatment:
      'Levothyroxine, dosed by weight (~1.6 µg/kg/day), taken on an empty stomach. Recheck TSH in 6 weeks and titrate to TSH 0.5–2.5 mIU/L. Lifelong therapy.',
    prevention:
      'Not preventable when autoimmune; iodine sufficiency (salt iodisation) prevents endemic deficiency hypothyroidism.',
    whenToWorry:
      'Severe hypothyroidism (myxoedema): hypothermia, bradycardia, altered mental status — medical emergency, hospital admission.',
    redFlags: [
      'Hypothermia + bradycardia (myxoedema coma)',
      'Pericardial effusion',
      'Severe lethargy or coma',
      'New-onset heart failure',
      'TSH > 100 mIU/L',
    ],
    mimics: [
      'Depression',
      'Anaemia',
      'Chronic fatigue syndrome',
      'Adrenal insufficiency',
      'Sleep apnoea',
    ],
  },
  {
    name: 'Hyperthyroidism',
    synonyms: ['overactive thyroid', 'graves', 'thyrotoxicosis', 'high thyroid'],
    icd10: 'E05',
    specialty: 'Endocrinology',
    summary:
      'Excess thyroid hormone, most often from Graves disease (autoimmune) or toxic nodular goitre. Causes weight loss, palpitations, heat intolerance, tremor, anxiety, and exophthalmos in Graves.',
    treatment:
      'Beta-blocker (propranolol) for symptom control. Definitive: methimazole (Graves), radioactive iodine ablation, or thyroidectomy. Pregnancy: propylthiouracil 1st trimester, methimazole after.',
    prevention:
      'Not generally preventable; recognise iodine-induced thyrotoxicosis after contrast or amiodarone.',
    whenToWorry:
      'Thyroid storm: high fever, tachycardia > 140, agitation, vomiting, heart failure — ICU emergency.',
    redFlags: [
      'HR > 140 + fever (thyroid storm)',
      'New atrial fibrillation',
      'Heart failure',
      'Severe ophthalmopathy / vision loss',
      'Pregnancy with uncontrolled disease',
    ],
    mimics: [
      'Anxiety / panic disorder',
      'Pheochromocytoma',
      'Stimulant or cocaine use',
      'Premenopausal hot flushes',
      'Atrial fibrillation from other cause',
    ],
  },
  {
    name: 'Obesity',
    synonyms: ['overweight', 'high bmi', 'weight problem', 'morbid obesity'],
    icd10: 'E66',
    specialty: 'Endocrinology',
    summary:
      'A chronic disease defined by excess body fat (BMI ≥ 30 kg/m²) that increases risk of diabetes, heart disease, sleep apnoea, joint disease, and many cancers.',
    treatment:
      'Stepwise: lifestyle (Mediterranean / DASH + 150 min/week activity) → behavioural therapy → GLP-1 / GIP agonists (semaglutide 2.4 mg, tirzepatide) → bariatric surgery (sleeve gastrectomy or RYGB) for BMI ≥ 35 with comorbidity.',
    prevention:
      'Family-level dietary patterns, school nutrition policy, walkable communities, limit ultra-processed food, regular exercise from childhood.',
    whenToWorry:
      'Rapid weight loss without trying ≥ 5 % in 6 months — investigate. Hypoventilation, sleep apnoea symptoms, or new joint pain — see clinician.',
    redFlags: [
      'Cushingoid features (proximal weakness, striae)',
      'Severe sleep apnoea / hypoventilation',
      'Pseudotumour cerebri',
      'Rapid weight gain in days (oedema)',
      'Suicidal ideation linked to body image',
    ],
    mimics: [
      'Hypothyroidism',
      'Cushing syndrome',
      'PCOS-driven weight gain',
      'Medication-induced (steroids, antipsychotics)',
      'Hypothalamic obesity',
    ],
  },

  // ───────── F — Mental Health ─────────
  {
    name: 'Major Depressive Disorder',
    synonyms: ['depression', 'mdd', 'major depression', 'clinical depression'],
    icd10: 'F33',
    specialty: 'Psychiatry',
    summary:
      'Persistent low mood, anhedonia, sleep / appetite change, low energy, and impaired concentration for ≥ 2 weeks. Suicidal ideation must always be screened.',
    treatment:
      'Mild–moderate: structured CBT or interpersonal therapy ± exercise. Moderate–severe: SSRI (sertraline, escitalopram) or SNRI as first-line; expect 4–6 weeks for full effect. Treatment-resistant: ketamine/esketamine, rTMS, ECT.',
    prevention:
      'Sleep hygiene, regular exercise, social connection, treat substance misuse, screen postnatally and in chronic illness.',
    whenToWorry:
      'Suicidal thoughts with a plan, severe self-neglect, psychotic features, or catatonia — same-day psychiatric assessment or ER.',
    redFlags: [
      'Suicidal plan + means',
      'Active self-harm',
      'Psychotic symptoms',
      'Catatonia',
      'Severe weight loss / dehydration',
    ],
    mimics: [
      'Hypothyroidism',
      'B12 deficiency',
      'Bipolar depression',
      'Adjustment disorder',
      'Substance-induced mood disorder',
    ],
  },
  {
    name: 'Generalised Anxiety Disorder',
    synonyms: ['gad', 'anxiety', 'chronic worry', 'anxiety disorder'],
    icd10: 'F41.1',
    specialty: 'Psychiatry',
    summary:
      'Excessive, hard-to-control worry across multiple domains for ≥ 6 months, with restlessness, fatigue, irritability, muscle tension, sleep disturbance, and impaired concentration.',
    treatment:
      'CBT is first-line. Pharmacology: SSRI (escitalopram, sertraline) or SNRI (venlafaxine). Avoid long-term benzodiazepines — dependence risk. Buspirone for SSRI partial responders.',
    prevention:
      'Mindfulness, exercise, limit caffeine and alcohol, treat sleep deprivation, early therapy in adolescence if family history.',
    whenToWorry:
      'Panic attacks with chest pain (rule out cardiac), suicidal ideation, or severe agoraphobia preventing leaving home — escalate care.',
    redFlags: [
      'Suicidal ideation',
      'Panic with chest pain (rule out MI / PE)',
      'Severe agoraphobia',
      'Substance misuse co-morbidity',
      'New onset > 50 years (consider organic cause)',
    ],
    mimics: [
      'Hyperthyroidism',
      'Pheochromocytoma',
      'Caffeine / stimulant use',
      'Cardiac arrhythmia',
      'Withdrawal (alcohol, benzodiazepines)',
    ],
  },
  {
    name: 'Insomnia',
    synonyms: ['cant sleep', "can't sleep", 'sleeplessness', 'insomnia disorder'],
    icd10: 'G47.00',
    specialty: 'Psychiatry',
    summary:
      'Difficulty falling asleep, staying asleep, or non-restorative sleep, with daytime impairment, ≥ 3 nights/week for ≥ 3 months (chronic insomnia).',
    treatment:
      'CBT-I is first-line — superior to drugs at 1 year. Short-term meds: low-dose doxepin, ramelteon, or zolpidem (≤ 4 weeks). Avoid daily benzodiazepines and antihistamines in the elderly.',
    prevention:
      'Consistent sleep schedule, dark cool bedroom, no screens 1 h before bed, no caffeine after midday, treat OSA if snoring + daytime sleepiness.',
    whenToWorry:
      'Insomnia + daytime sleepiness + loud snoring → screen for obstructive sleep apnoea. Insomnia + low mood + suicidal thoughts → urgent psych.',
    redFlags: [
      'Witnessed apnoeas / loud snoring',
      'Severe daytime sleepiness causing accidents',
      'Suicidal ideation',
      'Restless-leg symptoms',
      'Sleep paralysis with hallucinations (narcolepsy)',
    ],
    mimics: [
      'Obstructive sleep apnoea',
      'Restless legs syndrome',
      'Circadian rhythm disorder',
      'Depression / anxiety',
      'Chronic pain',
    ],
  },
  {
    name: 'Bipolar I Disorder',
    synonyms: ['bipolar', 'manic depression', 'mania', 'bipolar disorder'],
    icd10: 'F31',
    specialty: 'Psychiatry',
    summary:
      'Recurrent episodes of mania (elevated/irritable mood, decreased need for sleep, grandiosity, risk-taking) often interspersed with depressive episodes. Lifetime prevalence ~1 %.',
    treatment:
      'Acute mania: lithium, valproate, or atypical antipsychotic (olanzapine, risperidone). Maintenance: lithium remains the gold standard for suicide-risk reduction. Bipolar depression: quetiapine or lurasidone — avoid antidepressant monotherapy (manic switch).',
    prevention:
      'Adherence + sleep regulation prevents relapse. Avoid stimulants and recreational substances. Family psychoeducation reduces hospitalisation.',
    whenToWorry:
      'Active mania with psychosis, severe sleep deprivation, dangerous spending or sexual behaviour, or suicidal depression — psychiatric admission.',
    redFlags: [
      'Mania with psychosis',
      'Suicidal depression',
      'Sustained sleep deprivation',
      'Dangerous risk-taking',
      'Lithium toxicity signs (tremor, ataxia, confusion)',
    ],
    mimics: [
      'Substance-induced mood disorder (cocaine, amphetamines)',
      'Steroid psychosis',
      'Schizoaffective disorder',
      'Borderline personality disorder',
      'Hyperthyroidism',
    ],
  },

  // ───────── G — Neurological ─────────
  {
    name: 'Migraine',
    synonyms: ['migraines', 'headache', 'severe headache', 'cluster headache'],
    icd10: 'G43',
    specialty: 'Neurology',
    summary:
      'A recurrent, often unilateral, throbbing headache lasting 4–72 hours, frequently with nausea, light and sound sensitivity, and sometimes a visual aura before onset.',
    treatment:
      'Acute: triptan (sumatriptan, rizatriptan) or NSAID in a quiet, dark room; gepants (rimegepant) if triptan-contraindicated. Prevention if > 4 attacks/month: propranolol, topiramate, CGRP-monoclonals (erenumab, fremanezumab).',
    prevention:
      'Identify triggers (sleep deprivation, dehydration, alcohol, hormonal cycles), keep a headache diary, hydrate, regular sleep.',
    whenToWorry:
      'A sudden "worst headache of your life", headache with fever and neck stiffness, headache after a head injury, or new-onset headache after age 50 — call emergency services.',
    redFlags: [
      '"Thunderclap" sudden onset',
      'Fever + neck stiffness (meningitis)',
      'New focal neuro deficit',
      'New headache > 50 years',
      'Headache + papilloedema',
    ],
    mimics: [
      'Tension-type headache',
      'Cluster headache',
      'Subarachnoid haemorrhage',
      'Giant cell arteritis (> 50)',
      'Idiopathic intracranial hypertension',
    ],
  },
  {
    name: 'Stroke',
    synonyms: ['cva', 'brain attack', 'face droop', 'slurred speech'],
    icd10: 'I63',
    specialty: 'Neurology',
    summary:
      'A stroke is a brain attack — either from a clot blocking blood flow (ischaemic, ~85 %) or a vessel bursting (haemorrhagic). Every minute, 1.9 million neurons die.',
    treatment:
      'Call 911 IMMEDIATELY. Use the BE-FAST mnemonic: Balance, Eyes, Face droop, Arm weakness, Speech, Time. Ischaemic: tPA within 4.5 h; mechanical thrombectomy up to 24 h with imaging mismatch. Haemorrhagic: BP control + neurosurgery review.',
    prevention:
      'Control blood pressure (the single biggest risk factor), no smoking, manage atrial fibrillation with anticoagulation, statin if dyslipidaemia, exercise.',
    whenToWorry:
      "Face droop, arm weakness, or slurred speech — even if it resolves — call 911. Don't drive yourself.",
    redFlags: [
      'Sudden hemiparesis',
      'Sudden speech disturbance',
      'Sudden visual loss',
      'Sudden severe vertigo + ataxia',
      'Decreased consciousness',
    ],
    mimics: [
      'Hypoglycaemia',
      'Seizure with Todd paralysis',
      'Migraine with aura',
      'Multiple sclerosis flare',
      'Bell palsy (isolated facial weakness)',
    ],
  },
  {
    name: 'Epilepsy',
    synonyms: ['seizure', 'fits', 'convulsions', 'seizure disorder'],
    icd10: 'G40',
    specialty: 'Neurology',
    summary:
      'A chronic disorder of recurrent, unprovoked seizures. Generalised (tonic-clonic, absence) or focal (with or without awareness). Diagnosis after 2 unprovoked seizures or 1 with high recurrence risk.',
    treatment:
      'Monotherapy first: levetiracetam or lamotrigine for most adults. Focal: carbamazepine alternative. Refractory: add second drug, vagal-nerve stimulator, or epilepsy surgery for unilateral focus.',
    prevention:
      'Adherence is critical. Avoid sleep deprivation, alcohol binges, and identified triggers. Counsel against driving until seizure-free per local law (often 6–12 months).',
    whenToWorry:
      'Status epilepticus: a seizure > 5 min or repeated seizures without recovery — call 911. New focal neuro deficit between seizures — image.',
    redFlags: [
      'Seizure > 5 minutes',
      'Recurrent seizures without recovery',
      'First-ever seizure',
      'Postictal focal deficit',
      'Pregnancy with poor control',
    ],
    mimics: [
      'Syncope (convulsive)',
      'Psychogenic non-epileptic seizure',
      'TIA / stroke',
      'Hypoglycaemia',
      'Migraine with complex aura',
    ],
  },
  {
    name: 'Alzheimer Disease',
    synonyms: ['alzheimers', 'dementia', 'memory loss', 'ad'],
    icd10: 'G30',
    specialty: 'Neurology',
    summary:
      'Most common cause of dementia. Progressive, insidious decline in memory and cognition driven by amyloid-β plaques and tau tangles. Onset typically > 65 years.',
    treatment:
      'Cholinesterase inhibitors (donepezil) for mild–moderate; memantine added for moderate–severe. Anti-amyloid mAbs (lecanemab, donanemab) modestly slow decline in early disease. Caregiver support is essential.',
    prevention:
      'Cardiovascular risk control, hearing-aid use if hearing loss, mediterranean diet, social engagement, cognitive activity, sleep, and treating depression.',
    whenToWorry:
      'Acute change in cognition (delirium), wandering, falls, paranoia, or caregiver burnout — escalate care.',
    redFlags: [
      'Acute confusion (delirium overlay)',
      'Falls or syncope',
      'Severe weight loss',
      'Caregiver abuse signs',
      'Suicidal ideation',
    ],
    mimics: [
      'Vascular dementia',
      'Lewy body dementia',
      'Frontotemporal dementia',
      'Normal-pressure hydrocephalus',
      'Depression (pseudodementia)',
    ],
  },

  // ───────── H — Eye / Ear ─────────
  {
    name: 'Glaucoma',
    synonyms: ['eye pressure', 'optic nerve damage', 'open angle glaucoma'],
    icd10: 'H40',
    specialty: 'Ophthalmology',
    summary:
      'Progressive optic-nerve damage typically associated with elevated intraocular pressure. Often asymptomatic until late — peripheral vision lost first.',
    treatment:
      'First-line: prostaglandin-analogue drops (latanoprost) at night. Add beta-blocker, alpha-agonist, or carbonic-anhydrase inhibitor as needed. Selective laser trabeculoplasty (SLT) early. Surgery (trabeculectomy, MIGS) for refractory.',
    prevention:
      'Annual eye exam from age 40 (earlier with risk factors), control diabetes and hypertension, avoid steroid drops without supervision.',
    whenToWorry:
      'Acute angle-closure glaucoma: severe eye pain, headache, nausea, halos around lights, red eye — emergency.',
    redFlags: [
      'Acute eye pain + halos (angle closure)',
      'Sudden vision loss',
      'Severe headache + nausea',
      'Cloudy cornea',
      'Fixed mid-dilated pupil',
    ],
    mimics: [
      'Cataract (vision loss without pressure)',
      'Diabetic retinopathy',
      'Optic neuritis',
      'Migraine aura',
      'Macular degeneration',
    ],
  },
  {
    name: 'Otitis Media',
    synonyms: ['ear infection', 'middle ear infection', 'aom'],
    icd10: 'H66',
    specialty: 'ENT',
    summary:
      'Acute middle-ear infection, usually viral following a URTI; bacterial in ~30 % (S. pneumoniae, H. influenzae). Most common bacterial infection in children.',
    treatment:
      'Most resolve spontaneously in 48–72 h. Antibiotics if severe, bilateral in < 2 yr, or > 48 h: amoxicillin 80–90 mg/kg/day × 5–10 days. Pain control: paracetamol or ibuprofen.',
    prevention:
      'Vaccination (pneumococcal, influenza), no smoke exposure, breastfeeding, treat allergies, avoid bottle in supine position.',
    whenToWorry:
      'High fever > 39 °C unresponsive to antipyretics, severe ear pain with mastoid swelling, facial weakness, or stiff neck — same-day care.',
    redFlags: [
      'Mastoid swelling / tenderness (mastoiditis)',
      'Facial palsy',
      'Vertigo',
      'Meningismus',
      'Persistent symptoms > 72 h on antibiotic',
    ],
    mimics: [
      'Otitis externa',
      'TMJ disorder',
      'Dental pain referred',
      'Eustachian tube dysfunction',
      'Foreign body',
    ],
  },

  // ───────── I — Cardiovascular ─────────
  {
    name: 'Hypertension',
    synonyms: ['high blood pressure', 'bp', 'high bp', 'pressure'],
    icd10: 'I10',
    specialty: 'Cardiology',
    summary:
      'Persistently elevated blood pressure (≥130/80 by US guidelines, ≥140/90 by European). Often called the "silent killer" because most people have no symptoms until damage is done.',
    treatment:
      'Lifestyle first: DASH diet, less salt, more potassium, weight loss, regular exercise, alcohol moderation. If still high: ACE inhibitor (lisinopril), ARB (losartan), calcium channel blocker (amlodipine), or thiazide diuretic. Most patients need 2–3 drugs to reach goal.',
    prevention:
      'Limit sodium to under 2.3 g/day, exercise 30 min most days, maintain healthy weight, manage stress, limit alcohol.',
    whenToWorry:
      'BP over 180/120 with chest pain, severe headache, vision changes, or shortness of breath = hypertensive emergency. Call 911.',
    redFlags: [
      'BP > 180/120 with end-organ symptoms',
      'Severe headache + vision changes',
      'Chest pain',
      'New focal neuro deficit',
      'Pregnancy + BP > 140/90',
    ],
    mimics: [
      'White-coat hypertension',
      'Pheochromocytoma',
      'Renovascular hypertension',
      'Primary aldosteronism',
      'Sleep apnoea-driven hypertension',
    ],
  },
  {
    name: 'Heart Attack',
    synonyms: ['mi', 'myocardial infarction', 'chest pain', 'angina', 'stemi', 'nstemi'],
    icd10: 'I21',
    specialty: 'Cardiology',
    summary:
      'When a coronary artery is blocked, heart muscle starts to die within 20 minutes. Time is muscle.',
    treatment:
      'Call 911 immediately. Chew an aspirin (325 mg) if not allergic. ER: ECG within 10 min, troponin, primary PCI (cath lab) within 90 min for STEMI, or fibrinolytics if PCI not available. Long-term: dual antiplatelet, statin, beta-blocker, ACE inhibitor.',
    prevention:
      'No smoking, control BP and LDL (statin if needed), 150 min/week exercise, Mediterranean diet, manage diabetes, cardiac rehab post-event.',
    whenToWorry:
      'Crushing chest pain or pressure radiating to the left arm, jaw, or back, especially with shortness of breath, sweating, or nausea — call 911 now.',
    redFlags: [
      'Chest pain > 20 min unrelieved by rest',
      'Diaphoresis + nausea',
      'Radiation to jaw / left arm',
      'Syncope',
      'New heart failure signs',
    ],
    mimics: [
      'Aortic dissection',
      'Pulmonary embolism',
      'Pericarditis',
      'GERD / oesophageal spasm',
      'Costochondritis',
    ],
  },
  {
    name: 'Heart Failure',
    synonyms: ['chf', 'heart failure', 'hfref', 'hfpef', 'congestive heart failure'],
    icd10: 'I50',
    specialty: 'Cardiology',
    summary:
      'The heart cannot pump enough blood to meet the body’s needs. Reduced (HFrEF, EF ≤ 40 %) vs preserved ejection fraction (HFpEF, EF ≥ 50 %). Symptoms: dyspnoea, oedema, fatigue.',
    treatment:
      'HFrEF "four pillars": ARNi (sacubitril/valsartan) or ACE inhibitor, beta-blocker, MRA (spironolactone), SGLT2 inhibitor (dapagliflozin). HFpEF: SGLT2 inhibitor + diuretic + comorbidity control. Device: ICD / CRT per criteria.',
    prevention:
      'Treat hypertension, diabetes, dyslipidaemia, obesity, sleep apnoea. Limit alcohol; avoid cardiotoxic drugs.',
    whenToWorry:
      'Acute breathlessness at rest, pink frothy sputum, leg swelling that won’t resolve, sudden weight gain > 2 kg in 3 days — call same-day.',
    redFlags: [
      'Pink frothy sputum (pulmonary oedema)',
      'Resting dyspnoea / orthopnoea',
      '> 2 kg weight gain in 3 days',
      'Hypotension + cold extremities (cardiogenic shock)',
      'Syncope',
    ],
    mimics: [
      'COPD exacerbation',
      'Pulmonary embolism',
      'Pneumonia',
      'Cirrhosis with ascites',
      'Nephrotic syndrome',
    ],
  },
  {
    name: 'Atrial Fibrillation',
    synonyms: ['afib', 'irregular heartbeat', 'atrial fib', 'af'],
    icd10: 'I48',
    specialty: 'Cardiology',
    summary:
      'Disorganised atrial electrical activity giving an irregularly irregular pulse. Increases stroke risk 5-fold without anticoagulation.',
    treatment:
      'Rate control: beta-blocker (metoprolol) or non-DHP CCB (diltiazem). Rhythm: cardioversion or catheter ablation. Anticoagulation per CHA₂DS₂-VASc score: DOAC (apixaban, rivaroxaban) preferred over warfarin in most.',
    prevention:
      'Control hypertension, weight loss, treat sleep apnoea, limit alcohol, manage thyroid disease.',
    whenToWorry:
      'Rapid AF with chest pain, hypotension, syncope, or new neuro deficit — emergency. Stable rapid AF should still be evaluated same-day.',
    redFlags: [
      'Hypotension + altered mental status',
      'New chest pain',
      'New stroke symptoms',
      'HR > 150 sustained',
      'Heart-failure decompensation',
    ],
    mimics: [
      'Atrial flutter',
      'Multifocal atrial tachycardia',
      'Frequent PACs',
      'Sinus arrhythmia',
      'Wolff-Parkinson-White with AF',
    ],
  },
  {
    name: 'Deep Vein Thrombosis',
    synonyms: ['dvt', 'leg clot', 'venous thrombosis', 'leg blood clot'],
    icd10: 'I82',
    specialty: 'Cardiology',
    summary:
      'A blood clot forming in a deep leg vein, classically presenting with unilateral calf swelling, tenderness, and warmth. Risk: immobility, surgery, cancer, OCP, pregnancy, thrombophilia.',
    treatment:
      'DOAC (apixaban or rivaroxaban) is first-line for most; LMWH preferred in pregnancy and active cancer. Duration: 3 months minimum, longer if unprovoked or high-risk.',
    prevention:
      'Mobilise after surgery, mechanical or chemical prophylaxis in hospitalised patients, hydrate during long flights, calf exercises.',
    whenToWorry:
      'New unilateral leg swelling + sudden chest pain or breathlessness = pulmonary embolism. Call 911.',
    redFlags: [
      'Sudden dyspnoea (PE)',
      'Chest pain pleuritic',
      'Haemoptysis',
      'Syncope',
      'Unilateral leg swelling > 3 cm vs other side',
    ],
    mimics: [
      'Cellulitis',
      'Baker cyst rupture',
      'Muscle haematoma',
      'Lymphoedema',
      'Superficial thrombophlebitis',
    ],
  },

  // ───────── J — Respiratory ─────────
  {
    name: 'Asthma',
    synonyms: ['wheezing', 'shortness of breath', 'inhaler', 'reactive airway'],
    icd10: 'J45',
    specialty: 'Respiratory',
    summary:
      'Chronic inflammation of the airways causing reversible narrowing, wheezing, cough, and shortness of breath. Often triggered by allergens, exercise, cold air, or infections.',
    treatment:
      'Mild persistent: ICS-formoterol as both reliever AND controller (MART therapy, GINA 2024). Moderate-severe: add long-acting beta-agonist, tiotropium, or biologics (omalizumab for allergic, mepolizumab for eosinophilic).',
    prevention:
      'Identify and avoid triggers, take controller meds daily even when feeling fine, get the flu shot annually, action plan for flares.',
    whenToWorry:
      "If your reliever inhaler isn't helping, you can't speak in full sentences, your lips are turning blue, or your peak flow is under 50 % of your best — emergency room.",
    redFlags: [
      'Silent chest (poor air entry)',
      'SpO₂ < 92 %',
      'Cannot complete a sentence',
      'Cyanosis',
      'Altered mental status',
    ],
    mimics: [
      'COPD',
      'Vocal-cord dysfunction',
      'Heart failure',
      'Pulmonary embolism',
      'Foreign-body aspiration (children)',
    ],
  },
  {
    name: 'COPD',
    synonyms: ['chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'],
    icd10: 'J44',
    specialty: 'Respiratory',
    summary:
      'Persistent airflow limitation, usually from smoking. Chronic productive cough, exertional dyspnoea, recurrent infections; FEV₁/FVC < 0.7 post-bronchodilator.',
    treatment:
      'Smoking cessation is the single most effective intervention. Bronchodilators (LABA + LAMA), ICS only if asthma overlap or eosinophilic. Pulmonary rehab. Long-term oxygen if PaO₂ ≤ 55 mmHg. Vaccinate (flu, pneumococcal, RSV).',
    prevention:
      'Do not smoke. Avoid biomass smoke and occupational dusts. Annual flu and pneumococcal vaccination.',
    whenToWorry:
      'Exacerbation with new sputum purulence, fever, severe breathlessness, confusion, or hypoxia — emergency.',
    redFlags: [
      'SpO₂ < 88 % at rest',
      'CO₂ retention symptoms (drowsy)',
      'Use of accessory muscles + cyanosis',
      'New peripheral oedema (cor pulmonale)',
      'Confusion',
    ],
    mimics: [
      'Asthma',
      'Heart failure',
      'Bronchiectasis',
      'Interstitial lung disease',
      'Pulmonary embolism',
    ],
  },
  {
    name: 'Pneumonia',
    synonyms: ['lung infection', 'community acquired pneumonia', 'cap'],
    icd10: 'J18',
    specialty: 'Respiratory',
    summary:
      'Infection of lung parenchyma — fever, productive cough, pleuritic chest pain, and consolidation on imaging. Most common pathogens: S. pneumoniae, atypicals (mycoplasma), viral.',
    treatment:
      'Outpatient CAP: amoxicillin or doxycycline (azithromycin in some regions). Inpatient: ceftriaxone + azithromycin or respiratory fluoroquinolone. ICU: add anti-MRSA / anti-pseudomonal coverage if risk factors.',
    prevention:
      'Pneumococcal and influenza vaccines, no smoking, hand hygiene, maintain good oral health, treat reflux to reduce aspiration risk.',
    whenToWorry:
      'CURB-65 ≥ 2, hypoxia, confusion, BP < 90/60, RR > 30 — admit. Same-day care for any of those.',
    redFlags: [
      'SpO₂ < 92 %',
      'RR > 30',
      'Hypotension',
      'Confusion (CURB)',
      'Multi-lobe involvement',
    ],
    mimics: [
      'Pulmonary embolism',
      'Heart failure',
      'Tuberculosis',
      'Lung cancer with post-obstructive pneumonia',
      'Acute eosinophilic pneumonia',
    ],
  },
  {
    name: 'Obstructive Sleep Apnoea',
    synonyms: ['sleep apnea', 'osa', 'snoring with apnoea', 'sleep apnoea'],
    icd10: 'G47.33',
    specialty: 'Respiratory',
    summary:
      'Repeated upper-airway collapse during sleep, causing oxygen desaturation, fragmented sleep, and daytime sleepiness. Strongly linked to obesity, hypertension, and atrial fibrillation.',
    treatment:
      'CPAP is gold standard for moderate-severe OSA. Weight loss is disease-modifying. Mandibular advancement device for mild–moderate. Hypoglossal nerve stimulator for selected non-CPAP-tolerant patients.',
    prevention:
      'Maintain healthy weight, avoid alcohol/sedatives near bedtime, side-sleep position, treat nasal congestion.',
    whenToWorry:
      'Witnessed apnoeas + daytime sleepiness + uncontrolled hypertension or new AF — refer for sleep study.',
    redFlags: [
      'Severe daytime sleepiness causing accidents',
      'Treatment-resistant hypertension',
      'New atrial fibrillation',
      'Polycythaemia (high Hb)',
      'Right heart failure / cor pulmonale',
    ],
    mimics: [
      'Central sleep apnoea',
      'Insomnia',
      'Hypothyroidism',
      'Depression-related fatigue',
      'Narcolepsy',
    ],
  },

  // ───────── K — Gastrointestinal ─────────
  {
    name: 'GERD',
    synonyms: ['acid reflux', 'heartburn', 'gerd', 'reflux disease'],
    icd10: 'K21',
    specialty: 'Gastroenterology',
    summary:
      'Chronic retrograde flow of gastric contents into the oesophagus causing heartburn, regurgitation, and sometimes cough or laryngitis. Risk for Barrett oesophagus.',
    treatment:
      'Lifestyle: weight loss, head-of-bed elevation, avoid late-night meals, stop smoking. PPI (omeprazole, pantoprazole) for 4–8 weeks; step down to lowest effective dose. Consider fundoplication or magnetic sphincter for refractory.',
    prevention:
      'Maintain healthy weight, avoid trigger foods (mint, chocolate, fatty meals, alcohol), do not lie down within 3 h of eating.',
    whenToWorry:
      'Trouble swallowing, weight loss, vomiting blood, black stools, anaemia, or symptoms > 50 yr first onset — endoscopy.',
    redFlags: [
      'Dysphagia or odynophagia',
      'Unintentional weight loss',
      'Haematemesis or melaena',
      'Iron-deficiency anaemia',
      'New onset > 50 years',
    ],
    mimics: [
      'Cardiac chest pain (always rule out)',
      'Peptic ulcer disease',
      'Eosinophilic oesophagitis',
      'Functional dyspepsia',
      'Gastroparesis',
    ],
  },
  {
    name: 'Peptic Ulcer Disease',
    synonyms: ['stomach ulcer', 'duodenal ulcer', 'pud', 'peptic ulcer'],
    icd10: 'K27',
    specialty: 'Gastroenterology',
    summary:
      'Mucosal break in the stomach or duodenum, mostly caused by H. pylori or NSAIDs. Burning epigastric pain, often relieved (duodenal) or worsened (gastric) by food.',
    treatment:
      'Test and treat H. pylori — quadruple therapy (PPI + bismuth + tetracycline + metronidazole) for 14 days where resistance is high. Stop NSAIDs. PPI for 4–8 weeks; repeat endoscopy for gastric ulcer to confirm healing.',
    prevention:
      'Avoid chronic NSAIDs (or co-prescribe PPI), no smoking, moderate alcohol, eradicate H. pylori in high-risk patients.',
    whenToWorry:
      'Vomiting blood, black tarry stools, sudden severe abdominal pain (perforation), or shock — call 911.',
    redFlags: [
      'Haematemesis',
      'Melaena',
      'Sudden severe abdominal pain (perforation)',
      'Shock',
      'Persistent vomiting',
    ],
    mimics: ['GERD', 'Functional dyspepsia', 'Gastric cancer', 'Pancreatitis', 'Cholecystitis'],
  },
  {
    name: 'Irritable Bowel Syndrome',
    synonyms: ['ibs', 'spastic colon', 'functional bowel disorder'],
    icd10: 'K58',
    specialty: 'Gastroenterology',
    summary:
      'Chronic abdominal pain related to defecation, with altered stool frequency or form, no structural cause. Subtypes: IBS-C, IBS-D, IBS-M.',
    treatment:
      'Low-FODMAP diet trial (8 weeks then reintroduce). IBS-C: laxatives, linaclotide. IBS-D: loperamide, low-dose TCA, rifaximin. CBT and gut-directed hypnotherapy have strong evidence.',
    prevention:
      'Identify dietary triggers, regular meals, manage stress, maintain physical activity.',
    whenToWorry:
      'Onset > 50 yr, weight loss, blood in stool, nocturnal symptoms, anaemia, family history of IBD or CRC — investigate before labelling IBS.',
    redFlags: [
      'Onset > 50',
      'Rectal bleeding',
      'Weight loss',
      'Nocturnal symptoms',
      'Family history IBD or CRC',
    ],
    mimics: [
      'Inflammatory bowel disease',
      'Coeliac disease',
      'Colorectal cancer',
      'Microscopic colitis',
      'Lactose / fructose intolerance',
    ],
  },
  {
    name: 'Hepatitis B',
    synonyms: ['hep b', 'hbv', 'hepatitis b virus'],
    icd10: 'B16',
    specialty: 'Gastroenterology',
    summary:
      'DNA virus infecting hepatocytes, transmitted via blood, sexual contact, and perinatally. Acute infection often self-limited; chronic in 5 % of adults, > 90 % of perinatal cases.',
    treatment:
      'Acute: supportive. Chronic: tenofovir or entecavir suppress viral replication; treatment is long-term, not curative. Screen all patients for HCC every 6 months once cirrhosis develops.',
    prevention:
      'Universal infant vaccination, post-exposure prophylaxis (HBIG + vaccine), safe sex, do not share needles, screen pregnant women + treat with tenofovir if high viral load.',
    whenToWorry:
      'Acute hepatitis with confusion, severe jaundice, bleeding, or rapidly worsening liver tests — fulminant hepatic failure, urgent transplant evaluation.',
    redFlags: [
      'Encephalopathy',
      'Coagulopathy (INR > 1.5)',
      'Severe jaundice with rising ammonia',
      'Hepatorenal syndrome',
      'New ascites + fever (SBP)',
    ],
    mimics: [
      'Hepatitis A / C / E',
      'Drug-induced liver injury',
      'Autoimmune hepatitis',
      'Wilson disease',
      'Alcoholic hepatitis',
    ],
  },

  // ───────── L — Skin ─────────
  {
    name: 'Atopic Dermatitis',
    synonyms: ['eczema', 'atopic eczema', 'dermatitis'],
    icd10: 'L20',
    specialty: 'Dermatology',
    summary:
      'Chronic, relapsing inflammatory skin condition with itchy, dry, erythematous patches, typically in flexures. Strongly linked to other atopic disease (asthma, allergic rhinitis).',
    treatment:
      'Daily emollients are the foundation. Topical corticosteroids for flares (mild for face, mid-potency for trunk, short courses). Tacrolimus / pimecrolimus for face. Moderate-severe: dupilumab, JAK inhibitors (upadacitinib, abrocitinib).',
    prevention:
      'Daily moisturisation from infancy, avoid known irritants (soaps, fragrances, wool), short lukewarm showers, manage stress.',
    whenToWorry:
      'Eczema herpeticum (rapidly worsening, painful, monomorphic vesicles + fever) or bacterial superinfection (golden crusts + spread) — same-day care.',
    redFlags: [
      'Eczema herpeticum',
      'Cellulitis / impetiginisation with fever',
      'Erythroderma (> 90 % BSA)',
      'Failure to thrive (infants)',
      'Severe sleep loss from itch',
    ],
    mimics: [
      'Contact dermatitis',
      'Psoriasis',
      'Scabies',
      'Tinea corporis',
      'Cutaneous T-cell lymphoma (chronic)',
    ],
  },
  {
    name: 'Psoriasis',
    synonyms: ['plaque psoriasis', 'scaly skin', 'psoriatic'],
    icd10: 'L40',
    specialty: 'Dermatology',
    summary:
      'Chronic immune-mediated disease producing well-demarcated, erythematous plaques with silvery scale, typically on extensor surfaces, scalp, and nails. Comorbid psoriatic arthritis in ~30 %.',
    treatment:
      'Mild: topical steroids ± vitamin D analogues (calcipotriol). Moderate-severe: phototherapy (NB-UVB), methotrexate, or biologics (IL-17, IL-23, TNF-α inhibitors). Treat-to-target PASI-90.',
    prevention:
      'No primary prevention; trigger-avoidance: streptococcal infections (guttate), beta-blockers, lithium, abrupt steroid withdrawal, smoking, alcohol.',
    whenToWorry:
      'Erythrodermic psoriasis, generalised pustular psoriasis, or fever with extensive flare — admission for fluid balance and systemic therapy.',
    redFlags: [
      'Erythroderma',
      'Generalised pustular psoriasis',
      'Joint deformity / dactylitis (psoriatic arthritis)',
      'Cardiovascular event',
      'Severe psychological impact',
    ],
    mimics: [
      'Eczema',
      'Tinea corporis',
      'Mycosis fungoides',
      'Seborrhoeic dermatitis',
      'Pityriasis rosea',
    ],
  },

  // ───────── M — Musculoskeletal ─────────
  {
    name: 'Osteoarthritis',
    synonyms: ['oa', 'wear and tear arthritis', 'degenerative arthritis'],
    icd10: 'M19',
    specialty: 'Orthopaedics',
    summary:
      'Mechanical wear of articular cartilage with secondary bone remodelling — joint pain worse with activity, brief morning stiffness < 30 min, crepitus. Knees, hips, hands most often.',
    treatment:
      'Weight loss + structured exercise are the most effective interventions. Topical NSAIDs first, then oral if needed (gastroprotection in elderly). Intra-articular steroid for flares. Joint replacement for end-stage.',
    prevention:
      'Maintain healthy weight, strengthen surrounding muscles, avoid repetitive joint overload, manage previous joint injuries.',
    whenToWorry:
      'Sudden monoarthritis with fever — septic joint emergency. Pain at rest, night pain, weight loss — investigate for malignancy or infection.',
    redFlags: [
      'Sudden hot swollen joint + fever (septic arthritis)',
      'Night / rest pain',
      'Weight loss',
      'Sudden inability to bear weight',
      'Constitutional symptoms',
    ],
    mimics: [
      'Rheumatoid arthritis',
      'Gout / pseudogout',
      'Septic arthritis',
      'Avascular necrosis',
      'Bone metastasis',
    ],
  },
  {
    name: 'Rheumatoid Arthritis',
    synonyms: ['ra', 'rheumatoid', 'inflammatory arthritis'],
    icd10: 'M06',
    specialty: 'Rheumatology',
    summary:
      'Chronic systemic autoimmune disease causing symmetric small-joint synovitis, morning stiffness > 1 hour, fatigue, and progressive joint destruction without treatment.',
    treatment:
      'Early DMARD therapy is critical — methotrexate first-line. Add hydroxychloroquine, sulfasalazine, or biologic (TNF, IL-6, JAK inhibitor) if not in remission. Treat-to-target with DAS28 monitoring.',
    prevention:
      'Smoking cessation reduces RA risk and improves treatment response. No primary prevention; early diagnosis prevents joint destruction.',
    whenToWorry:
      'Sudden severe pain in a single joint (septic), neurological signs from C-spine subluxation, or new cardiac symptoms (pericarditis) — urgent.',
    redFlags: [
      'Septic joint on background RA',
      'Cervical-spine subluxation symptoms',
      'Pericarditis',
      'Vasculitis (skin ulcers, mononeuritis)',
      'Felty syndrome with infection',
    ],
    mimics: [
      'Psoriatic arthritis',
      'SLE',
      'Polymyalgia rheumatica',
      'Viral arthritis (parvovirus)',
      'Crystal arthritis',
    ],
  },
  {
    name: 'Lower Back Pain',
    synonyms: ['back pain', 'lumbago', 'lbp', 'lower back ache'],
    icd10: 'M54.5',
    specialty: 'Orthopaedics',
    summary:
      'Most common musculoskeletal complaint. ~85 % is non-specific mechanical back pain that resolves in 6 weeks. Imaging early without red flags is harmful and costly.',
    treatment:
      'Stay active, avoid bed rest > 2 days. NSAID short course, topical NSAIDs for the elderly, paracetamol if NSAID-contraindicated. Physiotherapy, exercise, CBT for chronic pain. Surgery only for clear nerve compression with neuro deficit.',
    prevention:
      'Core strengthening, ergonomic workstation, lift with the legs, maintain healthy weight, smoking cessation.',
    whenToWorry:
      'Saddle anaesthesia, urinary retention or incontinence, bilateral leg weakness — cauda equina syndrome, emergency MRI.',
    redFlags: [
      'Saddle anaesthesia + urinary retention (cauda equina)',
      'New foot drop',
      'IV drug use + back pain (epidural abscess)',
      'History of cancer',
      'Fever + night sweats',
    ],
    mimics: [
      'Renal colic / pyelonephritis',
      'Aortic aneurysm',
      'Pancreatitis (radiates back)',
      'Endometriosis',
      'Vertebral fracture',
    ],
  },
  {
    name: 'Gout',
    synonyms: ['uric acid arthritis', 'podagra', 'gouty arthritis'],
    icd10: 'M10',
    specialty: 'Rheumatology',
    summary:
      'Crystal arthropathy from monosodium-urate deposition. Sudden, exquisitely painful monoarthritis — classically the great-toe MTP joint. Risk: hyperuricaemia, alcohol, purine-rich diet, diuretics.',
    treatment:
      'Acute: NSAID, colchicine, or short oral steroid. Urate-lowering: allopurinol (start low, titrate to urate < 6 mg/dL), febuxostat as alternative. Always co-prescribe colchicine for first 3–6 months to prevent flare.',
    prevention:
      'Limit beer, spirits, red meat, organ meats, sugary drinks. Hydrate. Weight loss. Treat metabolic syndrome.',
    whenToWorry:
      'Hot swollen joint + fever — could be septic arthritis (must aspirate). Tophi causing nerve compression or skin ulceration — refer.',
    redFlags: [
      'Septic arthritis cannot be excluded',
      'Polyarticular gout with fever',
      'Tophi causing ulceration',
      'Renal stones',
      'Allopurinol hypersensitivity (SJS)',
    ],
    mimics: ['Septic arthritis', 'Pseudogout (CPPD)', 'Cellulitis', 'Reactive arthritis', 'Trauma'],
  },

  // ───────── N — Genitourinary ─────────
  {
    name: 'Chronic Kidney Disease',
    synonyms: ['ckd', 'kidney failure', 'renal insufficiency', 'kidney disease'],
    icd10: 'N18',
    specialty: 'Nephrology',
    summary:
      'Sustained reduction in eGFR < 60 mL/min/1.73 m² for ≥ 3 months, or kidney damage markers (proteinuria, structural). Mostly driven by diabetes and hypertension.',
    treatment:
      'BP control with ACE inhibitor or ARB if proteinuria. SGLT2 inhibitor (dapagliflozin) slows progression independent of diabetes. Tight glycaemic control, statin, dietary protein moderation. Plan dialysis access by stage 4.',
    prevention:
      'Control diabetes and hypertension, avoid chronic NSAIDs, smoking cessation, hydrate, treat urinary obstruction early.',
    whenToWorry:
      'Acute drop in eGFR, refractory hyperkalaemia, fluid overload with pulmonary oedema, uraemic symptoms (pericarditis, encephalopathy) — urgent.',
    redFlags: [
      'Hyperkalaemia > 6.5 mmol/L',
      'Pulmonary oedema',
      'Uraemic pericarditis',
      'Encephalopathy',
      'Severe metabolic acidosis',
    ],
    mimics: [
      'Acute kidney injury (volume / NSAID / contrast)',
      'Cardiorenal syndrome',
      'Renal artery stenosis',
      'Multiple myeloma',
      'Nephrotic syndrome',
    ],
  },
  {
    name: 'Benign Prostatic Hyperplasia',
    synonyms: ['bph', 'enlarged prostate', 'prostate enlargement'],
    icd10: 'N40',
    specialty: 'Urology',
    summary:
      'Non-malignant prostate growth in older men causing lower urinary tract symptoms — weak stream, hesitancy, nocturia, incomplete emptying. Common after age 50.',
    treatment:
      'Lifestyle (limit evening fluids and caffeine). Alpha-blocker (tamsulosin) for rapid symptom relief. 5α-reductase inhibitor (finasteride) for prostate > 40 g — months for benefit. Surgery (TURP, HoLEP) for refractory.',
    prevention:
      'No specific prevention; healthy weight, exercise, and Mediterranean diet associated with milder symptoms.',
    whenToWorry:
      'Acute urinary retention, haematuria, recurrent UTIs, or rising creatinine — urology referral.',
    redFlags: [
      'Acute urinary retention',
      'Gross haematuria',
      'Recurrent UTIs',
      'Rising creatinine',
      'Bladder stones',
    ],
    mimics: [
      'Prostate cancer',
      'Urethral stricture',
      'Neurogenic bladder',
      'Overactive bladder',
      'UTI with retention',
    ],
  },

  // ───────── O — Pregnancy ─────────
  {
    name: 'Pre-Eclampsia',
    synonyms: ['preeclampsia', 'pet', 'pregnancy hypertension', 'toxaemia'],
    icd10: 'O14',
    specialty: 'Obstetrics',
    summary:
      'New-onset hypertension after 20 weeks of pregnancy with proteinuria or end-organ dysfunction. Risk: nulliparity, prior PET, chronic HTN, diabetes, twins, advanced maternal age.',
    treatment:
      'Definitive: deliver. BP control: labetalol, nifedipine, methyldopa. Magnesium sulphate for severe features or seizure prophylaxis. Steroids for foetal lung maturity if < 34 weeks.',
    prevention:
      'Low-dose aspirin (81–162 mg) from 12–28 weeks for high-risk patients reduces incidence ~15 %. Calcium supplementation in low-intake populations.',
    whenToWorry:
      'Severe headache, visual changes, right-upper-quadrant pain, BP > 160/110, low platelets, abnormal LFTs — emergency obstetric assessment.',
    redFlags: [
      'BP ≥ 160/110',
      'Severe headache or visual scotoma',
      'RUQ pain (HELLP)',
      'Platelets < 100',
      'Pulmonary oedema',
    ],
    mimics: [
      'Chronic hypertension',
      'Gestational hypertension',
      'Acute fatty liver of pregnancy',
      'TTP-HUS',
      'Lupus flare',
    ],
  },

  // ───────── Q — Congenital ─────────
  {
    name: 'Sickle Cell Disease',
    synonyms: ['sickle cell anemia', 'scd', 'hbss'],
    icd10: 'D57',
    specialty: 'Haematology',
    summary:
      'Autosomal recessive haemoglobinopathy (HbS) with red cells that sickle under stress, causing vaso-occlusive pain crises, haemolysis, and chronic end-organ damage.',
    treatment:
      'Hydroxyurea reduces crises and mortality. Crizanlizumab (P-selectin inhibitor) and voxelotor for selected patients. Crisis management: hydration, analgesia (IV opioids), oxygen, screen for ACS / stroke. Curative: HSCT, gene therapy (exa-cel).',
    prevention:
      'Newborn screening + penicillin prophylaxis until age 5, pneumococcal and meningococcal vaccines, transcranial Dopplers in children to predict stroke risk, hydroxyurea early.',
    whenToWorry:
      'Acute chest syndrome (chest pain + fever + new infiltrate), stroke, splenic sequestration, priapism > 4 h — emergency.',
    redFlags: [
      'Acute chest syndrome',
      'Stroke / TIA',
      'Splenic sequestration (children)',
      'Aplastic crisis (parvovirus)',
      'Priapism > 4 hours',
    ],
    mimics: [
      'Other haemoglobinopathies (HbSC)',
      'Avascular necrosis pain (chronic)',
      'Pulmonary embolism',
      'Osteomyelitis',
      'Cholecystitis from pigment stones',
    ],
  },

  // ───────── R — Symptoms ─────────
  {
    name: 'Benign Paroxysmal Positional Vertigo',
    synonyms: ['vertigo', 'bppv', 'spinning sensation', 'dizziness'],
    icd10: 'H81.1',
    specialty: 'Neurology',
    summary:
      'Brief (< 1 min) episodes of true rotational vertigo triggered by head position change, from displaced otoconia in the posterior semicircular canal. Most common cause of vertigo.',
    treatment:
      'Epley canalith-repositioning manoeuvre — > 80 % success after 1–2 sessions. Avoid vestibular suppressants long-term (slows recovery). Vestibular rehab for residual imbalance.',
    prevention:
      'No clear prevention; sit up slowly, treat vitamin D deficiency (some evidence), avoid trauma.',
    whenToWorry:
      'Vertigo + new headache, neuro deficit, sudden hearing loss, or vertical nystagmus — central cause (stroke) until proven otherwise. Call 911.',
    redFlags: [
      'New focal neuro deficit',
      'Sudden hearing loss',
      'Vertical or direction-changing nystagmus',
      'Severe headache',
      'Inability to walk',
    ],
    mimics: [
      'Vestibular neuritis',
      'Ménière disease',
      'Cerebellar stroke',
      'Vestibular migraine',
      'Orthostatic hypotension',
    ],
  },

  // ───────── T — Toxic / Trauma ─────────
  {
    name: 'Anaphylaxis',
    synonyms: ['allergic reaction', 'severe allergy', 'epipen', 'throat swelling'],
    icd10: 'T78.2',
    specialty: 'Allergy',
    summary:
      'A severe, life-threatening allergic reaction. Symptoms come within minutes: hives, throat swelling, wheezing, drop in blood pressure, sometimes vomiting.',
    treatment:
      'Intramuscular adrenaline (epinephrine) 0.3–0.5 mg in the lateral thigh — this is the ONLY first-line treatment. Antihistamines and steroids are adjuncts. Always call 911 even if symptoms improve — biphasic reactions occur in ~5 % at 4–8 hours.',
    prevention:
      'Avoid known triggers, carry two EpiPens at all times, wear a medical alert bracelet, allergen immunotherapy where available (venom, peanut OIT).',
    whenToWorry:
      'Any throat swelling, difficulty breathing, or feeling faint after exposure to a known allergen — use your EpiPen and call 911.',
    redFlags: [
      'Stridor or hoarse voice',
      'Hypotension or syncope',
      'Wheeze + cyanosis',
      'Persistent vomiting + skin signs',
      'Biphasic reaction at 4–8 h',
    ],
    mimics: [
      'Vasovagal syncope',
      'Acute asthma',
      'Hereditary angio-oedema',
      'Panic attack',
      'Carcinoid flush',
    ],
  },
  {
    name: 'Concussion',
    synonyms: ['mild tbi', 'mild traumatic brain injury', 'head injury'],
    icd10: 'S06.0',
    specialty: 'Neurology',
    summary:
      'Mild traumatic brain injury from biomechanical force, with transient altered mental status (LOC not required). Headache, dizziness, nausea, photophobia, fogginess for days–weeks.',
    treatment:
      'Initial relative rest 24–48 h then graded return to activity (school, work, sport) per consensus protocols. Treat headache, sleep disturbance, anxiety. Avoid second-impact before recovery — risk of catastrophic oedema.',
    prevention:
      'Helmets in cycling and contact sport, fall-prevention in elderly, graduated return-to-play protocols, good neck strength.',
    whenToWorry:
      'Worsening headache, vomiting, focal neurological signs, seizure, slurred speech, asymmetric pupils, or LOC > 30 s — CT head and ER.',
    redFlags: [
      'LOC > 30 s',
      'Worsening headache + vomiting',
      'Focal neuro deficit',
      'Seizure',
      'GCS < 15 at 2 h',
    ],
    mimics: [
      'Subdural / epidural haematoma',
      'Vestibular dysfunction',
      'Cervicogenic headache',
      'Post-traumatic migraine',
      'Anxiety / PTSD',
    ],
  },
];
