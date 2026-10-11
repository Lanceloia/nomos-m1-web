"""Bounded delegation over public candidates, independent of world settlement."""
from dataclasses import dataclass, field
import uuid


class PolicyError(ValueError):
    """A refused control request, not a failed world transition."""


@dataclass(frozen=True)
class Candidate:
    index: int
    entry: str
    label: str
    key: tuple
    features: dict[str, int]
    meaning: str = ""
    expectations: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ScoredCandidate:
    candidate: Candidate
    score: int
    reason: str


@dataclass(frozen=True)
class SelectionStop:
    code: str
    message: str


def choose(candidates, weights, *, stable_peers=False):
    """Only explicitly authorized semantic peers use a stable target order."""
    ranked = []
    for candidate in candidates:
        terms = [(name, value * weights.get(name, 0))
                 for name, value in candidate.features.items() if value * weights.get(name, 0)]
        score = sum(value for _, value in terms)
        if score > 0:
            ranked.append(ScoredCandidate(candidate, score,
                          " + ".join(f"{name}:{value:+d}" for name, value in terms)))
    if not ranked:
        return None, SelectionStop("no_candidate", "当前没有适合这种倾向的自动行动，接下来由你选择。")
    highest = max(row.score for row in ranked)
    winners = [row for row in ranked if row.score == highest]
    def peer_key(row):
        return row.candidate.key
    if (len(winners) != 1 and stable_peers and all(row.candidate.meaning for row in winners)
            and len({row.candidate.meaning for row in winners}) == 1
            and len({peer_key(row) for row in winners}) == len(winners)):
        winner = min(winners, key=peer_key)
        return ScoredCandidate(winner.candidate, winner.score, winner.reason + " · 同类同分，按稳定目标次序"), None
    if len(winners) != 1:
        return None, SelectionStop("ambiguous", "几种不同的行动同样合适，请你来决定。")
    return winners[0], None


@dataclass
class PolicyRun:
    intent_id: str
    label: str
    limit: int
    stop_on_unexpected: bool = True
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "running"
    reason: str | None = None
    steps: list = field(default_factory=list)
    visited: set = field(default_factory=set)
    sites: set = field(default_factory=set)
    stop_detail: dict | None = None
    plan: dict | None = None

    def stop(self, reason, *, code, choices=()):
        self.status, self.reason = "stopped", reason
        self.stop_detail = {"code": code, "choices": [dict(row) for row in choices]}

    def snapshot(self):
        return {"id": self.id, "status": self.status, "label": self.label,
                "intentId": self.intent_id,
                "reason": self.reason, "executed": len(self.steps), "limit": self.limit,
                "steps": [dict(step) for step in self.steps],
                "stopOnUnexpected": self.stop_on_unexpected, "plan": self.plan,
                "stopDetail": None if self.stop_detail is None else {
                    "code": self.stop_detail["code"],
                    "choices": [dict(row) for row in self.stop_detail["choices"]]}}


def idle_snapshot():
    return {"id": None, "status": "idle", "label": None, "reason": None,
            "intentId": None,
            "executed": 0, "limit": 0, "steps": [], "stopDetail": None,
            "stopOnUnexpected": True, "plan": None}
