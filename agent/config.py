"""Load and merge agent configuration: defaults.yaml + one file per topic."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

from agent.sources.base import TopicConfig


@dataclass(frozen=True)
class LLMConfig:
    base_url: str
    model: str


@dataclass(frozen=True)
class DeliveryConfig:
    telegram_channel: str
    delivery_cadence_hours: int


@dataclass(frozen=True)
class Settings:
    llm: LLMConfig
    delivery: DeliveryConfig


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override on top of base; override wins on
    conflicting scalar keys, dicts are merged key by key."""
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_settings(defaults_path: Path) -> Settings:
    raw = _load_yaml(defaults_path)
    llm_raw = raw["llm"]
    delivery_raw = raw["delivery"]
    return Settings(
        llm=LLMConfig(base_url=llm_raw["base_url"], model=llm_raw["model"]),
        delivery=DeliveryConfig(
            telegram_channel=delivery_raw["telegram_channel"],
            delivery_cadence_hours=delivery_raw["delivery_cadence_hours"],
        ),
    )


def load_topics(topics_dir: Path, defaults_path: Path) -> list[TopicConfig]:
    defaults = _load_yaml(defaults_path)
    topics: list[TopicConfig] = []
    for topic_path in sorted(topics_dir.glob("*.yaml")):
        topic_raw = _load_yaml(topic_path)
        merged = _deep_merge(defaults, topic_raw)
        attention = merged.get("attention", {})
        topics.append(
            TopicConfig(
                slug=topic_path.stem,
                name=merged["name"],
                description=merged["description"].strip(),
                keywords=merged["keywords"],
                sources=merged["sources"],
                max_age_days=merged["max_age_days"],
                min_relevance=merged["min_relevance"],
                max_items=merged["max_items"],
                attention_enabled=attention.get("enabled", False),
                attention_min_score_gain=attention.get("min_score_gain", 0),
            )
        )
    return topics


def load_env(path: Path) -> None:
    """Load KEY=VALUE lines from path into os.environ, without overwriting
    variables the real environment already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())
