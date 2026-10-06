"""Entry point:
python -m agent [--preset PATH] [--data-dir DIR] [--dry-run | --preview] [--topic SLUG]
python -m agent report [--preset PATH] [--data-dir DIR] [--days N]
python -m agent panel [--data-dir DIR]"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from agent import config, engine, paths
from agent.preset import PresetError, load_preset

AGENT_DIR = Path(__file__).parent
DEFAULT_PRESET = AGENT_DIR / "presets" / "tony.yaml"


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["panel"]:
        from agent.panel import run_panel

        run_panel(argv[1:])
        return
    if argv[:1] == ["report"]:
        from agent.report import run_report

        run_report(argv[1:])
        return

    parser = argparse.ArgumentParser(prog="python -m agent")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--preview", action="store_true")
    parser.add_argument("--topic", default=None)
    parser.add_argument("--preset", type=Path, default=DEFAULT_PRESET)
    parser.add_argument("--data-dir", type=Path, default=None)
    args = parser.parse_args(argv)

    config.load_env(AGENT_DIR / ".env")
    try:
        preset = load_preset(args.preset)
        data = paths.for_preset(preset, args.data_dir)
    except PresetError as exc:
        print(f"Preset error: {exc}", file=sys.stderr)
        sys.exit(2)

    now = datetime.now(timezone.utc)
    adapters = engine.live_adapters(preset, data)
    if args.dry_run:
        engine.run_dry(preset, data, now, adapters, args.topic)
    elif args.preview:
        engine.run_preview(preset, data, now, adapters, args.topic)
    else:
        engine.run_real(preset, data, now, adapters, args.topic)


if __name__ == "__main__":
    main()
