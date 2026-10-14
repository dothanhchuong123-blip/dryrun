"""Hand a job to Gemini 4 Argon (chat-only, no repo access) and bring its work back.
Step-by-step guide: prompts/argon/HOW-TO.md

  uv run scripts/argon.py pack T01          -> dist/argon/T01/ (UPLOAD_ME.md + PROMPT.txt), opens Finder
  uv run scripts/argon.py import T01        -> after clicking Gemini's copy button: saves the clipboard, writes the files
  uv run scripts/argon.py import T01 PATH   -> same, from a saved answer (.md), a downloaded .zip or an unzipped folder

Build jobs (T01 T02 T03 T10 T11 T12) write only that task's files. Review jobs (A1..A9) only save the answer.
Packs contain only git-visible files, so .env and fixtures/tavily_cache never leave this machine.
"""
import argparse
import fnmatch
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "argon"
ENGINE_CTX = ["CLAUDE.md", "SPEC.md", "pyproject.toml", "backend/engine/types.py"]
UI_CTX = ["CLAUDE.md", "SPEC.md", "docs/EVENTS.md"]
PROTECTED = {"backend/engine/types.py", "docs/EVENTS.md", "backend/config.py", "SPEC.md", "CLAUDE.md",
             "pyproject.toml", "uv.lock"}

# job: (files to upload, files Argon may write)
BUILDS = {
    "T01": (ENGINE_CTX + ["backend/engine/market.py", "backend/engine/baseline.py"],
            ["backend/engine/market.py", "backend/engine/baseline.py", "tests/test_market.py"]),
    "T02": (ENGINE_CTX + ["backend/engine/inventory.py", "backend/engine/game.py"],
            ["backend/engine/inventory.py", "backend/engine/game.py", "tests/test_inventory_game.py"]),
    "T03": (ENGINE_CTX + ["backend/engine/market.py", "backend/engine/baseline.py", "backend/engine/inventory.py",
                          "backend/engine/stats.py", "backend/engine/montecarlo.py"],
            ["backend/engine/stats.py", "backend/engine/montecarlo.py", "tests/test_stats_mc.py"]),
    "T10": (UI_CTX + ["frontend/"], ["frontend/*"]),
    "T11": (UI_CTX + ["frontend/"],
            ["frontend/components/Terminal.tsx", "frontend/components/GroundingCards.tsx",
             "frontend/components/terminal/*", "frontend/lib/format.ts", "frontend/package.json"]),
    "T12": (UI_CTX + ["frontend/"], ["frontend/components/Arena.tsx", "frontend/components/arena/*"]),
}
# job: (text files bundled into UPLOAD_ME.md, images copied next to it). "" = the whole repo.
REVIEWS = {
    "A1": (["SPEC.md", "backend/engine/types.py"], []),
    "A2": (["SPEC.md", "backend/agents/", "fixtures/archetypes.json"], []),
    "A3": ([""], []),
    "A4": (["SPEC.md", "backend/engine/types.py", "fixtures/scenarios/"], []),
    "A5": ([], []),
    "A6": (["docs/FEEDBACK.md"], ["bench/results/*.png"]),
    "A7": (["dist/ceo_prompt_example.md"], []),
    "A8": ([], []),
    "A9": (["README.md", "docs/DEVPOST.md", "docs/FEEDBACK.md", "docs/SUBMISSION.md"], ["docs/media/*.png"]),
}

SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".lock", ".jsonl", ".woff", ".woff2"}
SKIP_NAMES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", ".gitkeep", ".DS_Store"}
SKIP_DIRS = {"node_modules", ".next", "out", "__pycache__", ".venv"}
KEY_PATTERN = re.compile(r"(sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{30,})")
BLOCK = re.compile(r"^## `([^`\n]+)`[ \t]*\n+(`{3,}|~{3,})[^\n]*\n(.*?)\n\2[ \t]*$", re.MULTILINE | re.DOTALL)
HEADING = re.compile(r"^## `([^`\n]+)`", re.MULTILINE)

BUILD_WRAPPER = """You are a senior engineer building ONE task of a hackathon project: task {job}.
You do not have the repository. The attached UPLOAD_ME.md contains every file you need, each under a "## `path`" heading. CLAUDE.md and SPEC.md describe the project; the task below names the sections to read. Stub files show where your code goes.

The task text was written for an agent with repo access, so skip the steps that need it (git commit, screenshots, files that are not attached). Everything else applies: file names, function signatures, behaviour, tests and performance targets.

Rules:
1. Only create or change these files:
{allow}
2. Never change the shared contracts (backend/engine/types.py, docs/EVENTS.md, backend/config.py, SPEC.md, CLAUDE.md). If one seems wrong, say so in Notes.
3. No new dependencies unless the task asks for one.
4. If you can execute code, run the tests and fix failures before answering. Say in Notes whether you ran them.

Answer format (a script parses it, so follow it exactly). For every file, output its COMPLETE content, with no "..." or "unchanged" placeholders, as:

## `path/from/repo/root.ext`
```lang
<whole file>
```

If a file itself contains ``` lines, fence it with ```` instead. Use no other "## `" headings. If you run out of space, stop after a complete file and I will say "continue".
End with a "## Notes" section: assumptions, anything you could not verify, and problems with the shared contracts.

TASK {job}:
{task}
"""


def git_files() -> list[str]:
    return subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                          cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()


def bundle(entries: list[str], out: Path) -> None:
    listed = git_files()
    picked = [f for f in listed if any(f == e or (e.endswith("/") or e == "") and f.startswith(e) for e in entries)]
    # explicitly named files under dist/ are gitignored but safe (e.g. the A7 CEO prompt)
    picked += [e for e in entries if e.startswith("dist/") and (ROOT / e).is_file()]
    parts, skipped = [], []
    for rel in sorted(set(picked)):
        path = ROOT / rel
        if path.name.startswith(".env") and path.name != ".env.example":
            skipped.append((rel, "env file"))
            continue
        if path.suffix in SKIP_SUFFIXES or path.name in SKIP_NAMES or not path.is_file():
            continue
        if path.stat().st_size > 200_000:
            skipped.append((rel, "too large"))
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        if KEY_PATTERN.search(text):
            skipped.append((rel, "looks like it contains a key"))
            continue
        fence = "````" if "```" in text else "```"
        parts.append(f"## `{rel}`\n\n{fence}{path.suffix.lstrip('.')}\n{text.rstrip()}\n{fence}\n")
    out.write_text(f"# Files from the Market Digital Twin repo ({len(parts)} files)\n\n" + "\n".join(parts))
    print(f"  UPLOAD_ME.md: {len(parts)} files, ~{out.stat().st_size // 4:,} tokens")
    for rel, why in skipped:
        print(f"  skipped {rel}: {why}")
    for e in entries:
        if e.startswith("dist/") and not (ROOT / e).is_file():
            print(f"  MISSING {e}: create it first (see the review's instructions)")


def task_file(job: str) -> Path:
    pattern = f"prompts/*/{job}-*.md" if job in BUILDS else f"prompts/argon/reviews/{job}-*.md"
    found = sorted(ROOT.glob(pattern))
    if not found:
        sys.exit(f"No prompt file matches {pattern}")
    return found[0]


def pack(job: str, open_folder: bool = True) -> None:
    d = OUT / job
    d.mkdir(parents=True, exist_ok=True)
    for old in [d / "UPLOAD_ME.md", d / "PROMPT.txt", *d.glob("*.png")]:
        old.unlink(missing_ok=True)
    src = task_file(job)
    print(f"Packing {job} from {src.relative_to(ROOT)}")
    if job in BUILDS:
        uploads, allow = BUILDS[job]
        body = src.read_text().split("\n---\n", 1)[1].strip()
        prompt = BUILD_WRAPPER.format(job=job, allow="\n".join(f"   - {a}" for a in allow), task=body)
        images: list[str] = []
    else:
        uploads, images = REVIEWS[job]
        m = re.search(r"```text\n(.*?)\n```", src.read_text(), re.DOTALL)
        if not m:
            sys.exit(f"{src} has no ```text block")
        prompt = m.group(1)
    if uploads:
        bundle(uploads, d / "UPLOAD_ME.md")
    for pattern in images:
        for img in sorted(ROOT.glob(pattern)):
            shutil.copy(img, d / img.name)
            print(f"  image: {img.name}")
    (d / "PROMPT.txt").write_text(prompt)
    print(f"\nReady: {d}")
    print("Upload everything in that folder except PROMPT.txt, then paste PROMPT.txt as your message.")
    if not uploads and not images:
        print("This review has no files to pack: upload your own screenshots or video instead.")
    if open_folder and sys.platform == "darwin":
        subprocess.run(["open", str(d)], check=False)


def allowed(rel: str, patterns: list[str]) -> bool:
    return rel not in PROTECTED and any(fnmatch.fnmatch(rel, p) for p in patterns)


def collect(src: Path | None, d: Path) -> tuple[dict[str, str], list[str]]:
    """Return {path: content} from the clipboard, a saved answer, a .zip or a folder, plus cut-off paths."""
    if src is not None and (src.is_dir() or src.suffix == ".zip"):
        files: dict[str, str] = {}
        if src.is_dir():
            items = [(p.relative_to(src).as_posix(), p.read_bytes()) for p in src.rglob("*") if p.is_file()]
        else:
            with zipfile.ZipFile(src) as z:
                items = [(n, z.read(n)) for n in z.namelist() if not n.endswith("/")]
        for rel, data in items:
            if SKIP_DIRS & set(rel.split("/")) or Path(rel).name in SKIP_NAMES:
                continue
            try:
                files[rel] = data.decode()
            except UnicodeDecodeError:
                continue
        return files, []
    if src is None:
        text = subprocess.run(["pbpaste"], capture_output=True, text=True, check=True).stdout
        if len(text.strip()) < 300:
            sys.exit(f"The clipboard holds {len(text.strip())} characters ({text.strip()[:60]!r}), "
                     "which isn't Gemini's answer. Click the copy icon under Gemini's reply, then run this again.")
    else:
        text = src.read_text()
    n = 1
    while (d / f"ANSWER-{n}.md").exists():
        n += 1
    (d / f"ANSWER-{n}.md").write_text(text)
    print(f"Saved the answer to {(d / f'ANSWER-{n}.md').relative_to(ROOT)}")
    files = {m.group(1).strip(): m.group(3) + "\n" for m in BLOCK.finditer(text)}
    cut = [h for h in HEADING.findall(text) if h.strip() not in files]
    return files, cut


def do_import(job: str, src: Path | None) -> None:
    d = OUT / job
    d.mkdir(parents=True, exist_ok=True)
    if job in REVIEWS:
        collect(src, d)
        print(f"Next: new Claude Code session (Sonnet 5.5, effort medium) and type:\n"
              f"  Check the Argon review in dist/argon/{job}/ using prompts/argon/check-review.md")
        return
    patterns = BUILDS[job][1]
    files, cut = collect(src, d)
    written, refused = [], []
    for rel, content in files.items():
        rel = rel.removeprefix("./")
        if not allowed(rel, patterns) and "/" in rel and allowed(rel.split("/", 1)[1], patterns):
            rel = rel.split("/", 1)[1]  # zip with a top-level folder
        if ".." in rel.split("/") or not allowed(rel, patterns):
            refused.append(rel)
            continue
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        written.append(rel)
    for rel in written:
        print(f"  wrote   {rel}")
    for rel in refused:
        print(f"  REFUSED {rel} (not one of {job}'s files)")
    for rel in cut:
        print(f"  CUT OFF {rel}: reply \"continue\" in Gemini, copy the next part, run this command again")
    if not written:
        sys.exit("Nothing was written. Is the answer in the '## `path`' + code block format?")
    print(f"\nNext: new Claude Code session (Sonnet 5.5, effort medium) and type:\n"
          f"  Check the Argon build of {job} using prompts/argon/check-build.md")


def main() -> None:
    ap = argparse.ArgumentParser(description="Gemini 4 Argon hand-off (see prompts/argon/HOW-TO.md)")
    ap.add_argument("action", choices=["pack", "import"])
    ap.add_argument("job", type=str.upper, choices=[*BUILDS, *REVIEWS])
    ap.add_argument("path", nargs="?", type=Path, help="saved answer .md, downloaded .zip or folder (default: clipboard)")
    ap.add_argument("--no-open", action="store_true", help="don't open the pack folder in Finder")
    a = ap.parse_args()
    pack(a.job, not a.no_open) if a.action == "pack" else do_import(a.job, a.path)


if __name__ == "__main__":
    main()
