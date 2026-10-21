"""Lance tous les tests (python tests/run_all.py). Code de sortie non nul si un test échoue."""
import pathlib, subprocess, sys, time

here = pathlib.Path(__file__).resolve().parent
tests = sorted(here.glob("test_*.py"))
only = sys.argv[1:]
if only: tests = [t for t in tests if any(o in t.stem for o in only)]
failed = []
for t in tests:
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, str(t)], capture_output=True, text=True, timeout=300)
        out, code = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, code = "délai dépassé (300 s)", 1
    print(f"{'OK  ' if code == 0 else 'ÉCHEC'} {t.stem} ({time.time() - t0:.0f} s)")
    if code:
        failed.append(t.stem)
        print("\n".join("    " + l for l in out.strip().splitlines()[-25:]))
        # dans GitHub Actions : le détail apparaît aussi dans les annotations du traitement
        bad = [l.strip() for l in out.splitlines() if l.startswith("FAIL") or "Error" in l][-6:] or out.strip().splitlines()[-3:]
        print(f"::error title={t.stem}::" + " | ".join(bad).replace("\n", " ")[:900])
print(f"\n{len(tests) - len(failed)}/{len(tests)} tests réussis")
sys.exit(1 if failed else 0)
