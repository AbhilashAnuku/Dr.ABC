#!/usr/bin/env python
"""kaggle-bulk-pull — research-grade bulk medical-data downloads.

Architect's ask (v0.7.5): "use kaggle and other free tiers and get
the bulk data not just some samples · this is research."

Requires Kaggle auth at ~/.kaggle/kaggle.json (or KAGGLE_USERNAME +
KAGGLE_KEY env vars). Generate one at https://www.kaggle.com/settings
→ API → Create New Token.

Datasets pulled (~10-50 GB total depending on flags):

  Tabular / Q&A
    --uciml-pima                  768 rows  · diabetes-pima
    --uciml-heart                  303 rows · heart-disease-uci
    --diabetic-readmission   100,000 rows  · UCI diabetic-readmission
    --mimic-iv-demo              500 patients · MIMIC-IV demo (1.4 GB)
    --healthcare-stroke         5,110 rows  · stroke prediction

  Imaging
    --isic-skin             25,331 images  · ISIC 2019 dermoscopy (~3 GB)
    --chest-xray             5,856 images  · pneumonia (Kermany 2018, ~1.2 GB)
    --brain-mri-tumor        3,064 MRI    · 4-class tumor (~750 MB)
    --diabetic-retinopathy   5,590 images · APTOS 2019 (~9 GB)
    --covid-radiography     21,165 images · 4-class COVID/normal/lung-opacity/viral (~600 MB)

  Pharma / drug
    --drugbank-vocabulary  500,000 entries · DrugBank Open Vocabulary (~30 MB)
    --rxnorm                 latest · NIH RxNorm (~150 MB)

  --all : every dataset above (large; needs ~50 GB free on F:)

Usage:
  py scripts/kaggle-bulk-pull.py --all
  py scripts/kaggle-bulk-pull.py --isic-skin --chest-xray --diabetic-readmission
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "kaggle"
DATA.mkdir(parents=True, exist_ok=True)


PULLS = {
    # tabular / q&a
    "uciml-pima": ("uciml/pima-indians-diabetes-database", "tabular/pima"),
    "uciml-heart": ("ronitf/heart-disease-uci", "tabular/heart"),
    "diabetic-readmission": (
        "brandao/diabetes",
        "tabular/diabetic-readmission",
    ),
    "mimic-iv-demo": ("paultimothymooney/mimic-iv-demo", "tabular/mimic-iv-demo"),
    "healthcare-stroke": (
        "fedesoriano/stroke-prediction-dataset",
        "tabular/stroke",
    ),
    # imaging
    "isic-skin": ("nodoubttome/skin-cancer9-classesisic", "imaging/isic"),
    "chest-xray": (
        "paultimothymooney/chest-xray-pneumonia",
        "imaging/chest-xray",
    ),
    "brain-mri-tumor": (
        "sartajbhuvaji/brain-tumor-classification-mri",
        "imaging/brain-mri-tumor",
    ),
    "diabetic-retinopathy": (
        "mariaherrerot/aptos2019",
        "imaging/diabetic-retinopathy",
    ),
    "covid-radiography": (
        "tawsifurrahman/covid19-radiography-database",
        "imaging/covid-radiography",
    ),
    # pharma
    "drugbank-vocabulary": (
        "thedevastator/drug-information-from-drugs-com",
        "pharma/drugs-com",
    ),
    "rxnorm": ("djhmateer/rxnorm-may-2024", "pharma/rxnorm"),
}


def have_kaggle_auth() -> bool:
    home_kag = Path(os.path.expanduser("~/.kaggle/kaggle.json"))
    return (
        home_kag.exists()
        or bool(os.environ.get("KAGGLE_API_TOKEN"))  # new-style access token
        or (os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"))
    )


def pull_one(slug: str, out_subdir: str) -> bool:
    out = DATA / out_subdir
    out.mkdir(parents=True, exist_ok=True)
    print(f"\n[kaggle-bulk-pull] {slug}  →  {out.relative_to(ROOT)}")
    sys.stdout.flush()
    # Locate the kaggle CLI explicitly — `python -m kaggle` doesn't work
    # with the new package layout. Use the entry-point script.
    kaggle_exe = shutil.which("kaggle") or os.path.join(
        os.path.dirname(sys.executable), "Scripts", "kaggle.exe"
    )
    if not Path(kaggle_exe).exists():
        # Fallback to %APPDATA%\Roaming\Python\Python*\Scripts\kaggle.exe
        roaming = Path(os.path.expanduser(r"~\AppData\Roaming\Python"))
        if roaming.exists():
            for p in sorted(roaming.glob("Python*/Scripts/kaggle.exe"), reverse=True):
                kaggle_exe = str(p)
                break
    cmd = [
        kaggle_exe,
        "datasets",
        "download",
        "-d",
        slug,
        "-p",
        str(out),
        "--unzip",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if r.returncode != 0:
            print(f"  ✗ exit {r.returncode}")
            print(f"    stderr: {r.stderr[-400:]}")
            return False
        # Manifest
        files = list(out.rglob("*"))
        size = sum(f.stat().st_size for f in files if f.is_file())
        print(f"  ✓ {len(files)} files · {size / (1024**2):.1f} MB")
        (out / ".manifest.json").write_text(
            json.dumps(
                {
                    "kaggle_slug": slug,
                    "files": len(files),
                    "size_bytes": size,
                    "fetched_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
                },
                indent=2,
            )
        )
        return True
    except subprocess.TimeoutExpired:
        print("  ✗ timeout (1h)")
        return False
    except Exception as e:
        print(f"  ✗ {type(e).__name__}: {e}")
        return False


def parse_args():
    p = argparse.ArgumentParser()
    for k in PULLS.keys():
        p.add_argument(f"--{k}", action="store_true")
    p.add_argument("--all", action="store_true")
    return p.parse_args()


def main():
    args = parse_args()
    if not have_kaggle_auth():
        print(
            "[kaggle-bulk-pull] FATAL: no kaggle credentials found.\n"
            "  1. Open https://www.kaggle.com/settings\n"
            "  2. Click 'Create New Token' → downloads kaggle.json\n"
            "  3. Save to ~/.kaggle/kaggle.json (or set KAGGLE_USERNAME + KAGGLE_KEY env)\n"
            "  4. Re-run this script."
        )
        sys.exit(2)

    chosen = []
    if args.all:
        chosen = list(PULLS.keys())
    else:
        for k in PULLS.keys():
            if getattr(args, k.replace("-", "_")):
                chosen.append(k)
    if not chosen:
        print(__doc__)
        sys.exit(1)

    print(f"[kaggle-bulk-pull] pulling {len(chosen)} datasets into {DATA}")
    ok = 0
    for k in chosen:
        slug, sub = PULLS[k]
        if pull_one(slug, sub):
            ok += 1
    print(f"\n[kaggle-bulk-pull] done · {ok}/{len(chosen)} succeeded")


if __name__ == "__main__":
    main()
