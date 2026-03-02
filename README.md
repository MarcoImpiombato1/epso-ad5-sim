# EPSO AD5 2026 – Simulator (L1 ITA, L2 ENG)

**From-scratch** GitHub Pages simulator with:
- Exam mode (timed sections + thresholds)
- Training mode (adaptive difficulty + repeats wrong items)

## Local run
```bash
pip install mkdocs pyyaml
python tools/build_bank.py
cd site
mkdocs serve
```
