"""Bind authored opportunity meanings to the selected Program's public frame."""
from dataclasses import dataclass, fields
from copy import deepcopy
from pathlib import Path
from typing import get_type_hints
import hashlib

from .runtime import WORLD_ROOT, install_roots


@dataclass(frozen=True)
class Local:
    charge: int | None
    reservoir: int | None
    floor_known: bool
    floor_frozen: bool
    routes_known: bool
    person_detailed: bool
    ritual_active: bool = False
    nearby_people: bool = False


@dataclass(frozen=True)
class Opportunity:
    was_tried: bool
    has_targets: bool
    target_count: int
    targets_detailed: bool
    frozen_count: int
    floor_targets: bool
    destination_new: bool
    destination_unknown: bool
    approaching_need: bool
    icy: bool
    has_destination: bool
    approaching_goal: bool = False
    evidence_changed: bool = False
    crossing_alternative: bool = False


VALUE_TYPES = {"torch_gain": int, "torch_spend": int, "reservoir_spend": int,
               "reveals_reservoir": bool, "movement": bool,
               "interruption": bool, "invitation": bool, "departure": bool,
               "inspection": bool}


def public_ports():
    from nomos_c0.composable_value_v1 import C0ValuePorts
    roots = {"local": Local, "candidate": Opportunity}
    paths = frozenset(f"{name}.{field.name}" for name, carrier in roots.items()
                      for field in fields(carrier))
    reads = {carrier: frozenset(field.name for field in fields(carrier))
             for carrier in roots.values()}
    return C0ValuePorts(roots, paths, paths, reads, reads, {}, {}, {}, {}, {}, VALUE_TYPES)


class AuthoredAppraisal:
    def __init__(self, *, program=None, seat="adventurer", document=None, path=None):
        install_roots()
        from nomos_c0.author_contract_v1 import C0LawError
        from nomos_c0.author_document_v1 import parse_author_document
        from nomos_c0.offer_appraisal_v1 import compile_offer_appraisal
        from nomos_kernel._dynamic_owner_abi import _K0IndividualRef
        selected = Path(path) if path else WORLD_ROOT / "player.appraisal.yaml"
        self.program, self.seat = program, seat
        if document is None:
            parsed = parse_author_document(selected.read_text(encoding="utf-8"),
                                           file=str(selected), format="yaml")
            document, self.digest = parsed.to_data(), parsed.digest
            preferences = Path(__file__).parent / 'policies/m1_appraisal_preferences_v1.yaml'
            patch = parse_author_document(preferences.read_text(encoding='utf-8'),
                                          file=str(preferences), format='yaml')
            overrides = patch.to_data()
            if (type(overrides) is not dict or set(overrides) != {'schema', 'definitions'}
                    or overrides['schema'] != 'm1.appraisal_preferences.v1'
                    or type(overrides['definitions']) is not dict):
                raise C0LawError('Malformed application appraisal preferences')
            for name, override in overrides['definitions'].items():
                if name not in document['appraisal']['definitions'] or type(override) is not dict or set(override) != {'when'}:
                    raise C0LawError('Appraisal preference needs a declared judgment and only its when condition')
                document['appraisal']['definitions'][name]['when'] = override['when']
            self.digest = hashlib.sha256((self.digest + patch.digest).encode()).hexdigest()
        else:
            self.digest = "test-document"
        if type(document) is not dict or set(document) != {"appraisal", "inputs"}:
            raise C0LawError("player appraisal needs appraisal and inputs")
        self.inputs = deepcopy(document["inputs"])
        raw = document["appraisal"]
        if program is None:
            # Pure mechanism tests supply this catalog; application always binds a Program.
            entries = frozenset(raw["bindings"]) | frozenset(raw["manual"])
            actions = None
        else:
            selected_seat = next(item for item in program.seats if item.symbol == seat)
            entries = frozenset(selected_seat.entries)
            actions = dict(program.actions)
        self.compiled = compile_offer_appraisal(raw, ports=public_ports(), entries=entries)
        self.feature_ports = {entry: frozenset(raw['definitions'][definition]['features'])
                              for entry, definition in self.compiled.bindings.items()}
        if type(self.inputs) is not dict or set(self.inputs) != set(self.compiled.bindings):
            raise C0LawError("appraisal input bindings must exactly cover rated entries")
        for entry, row in self.inputs.items():
            if (type(row) is not dict or set(row) != {"destination", "targets", "movement_kind", "scope"}
                    or type(row["scope"]) is not str or not row["scope"].isidentifier()
                    or row["movement_kind"] not in ("", "walk", "bridge", "door", "ice", "carry")
                    or type(row["targets"]) is not list
                    or any(type(key) is not str or not key for key in row["targets"])
                    or len(set(row["targets"])) != len(row["targets"])):
                raise C0LawError(f"appraisal input {entry}: malformed projection")
            destination = row["destination"]
            if destination is not None and (type(destination) is not dict
                    or set(destination) != {"kind", "field"}
                    or destination["kind"] not in ("payload", "known_crossing")
                    or type(destination["field"]) is not str):
                raise C0LawError(f"appraisal input {entry}: malformed destination")
            if bool(destination) != bool(row["movement_kind"]):
                raise C0LawError(f"appraisal input {entry}: movement needs a declared destination")
            if actions is not None:
                hints = get_type_hints(actions[entry].payload_type)
                if (any(hints.get(key) not in (str, _K0IndividualRef) for key in row["targets"])
                        or destination and hints.get(destination["field"]) is not str):
                    raise C0LawError(f"appraisal input {entry}: unknown or incompatible payload field")

    def project(self, entry, payload, crossings, identities, observed_ids):
        """Payload is already offered to this seat; identities require local evidence."""
        row = self.inputs.get(entry)
        if row is None:
            return None
        result = {}
        selector = row["destination"]
        if selector:
            value = payload.get(selector["field"])
            destination = crossings.get(value) if selector["kind"] == "known_crossing" else value
            if type(destination) is str:
                result.update(destination=destination, movementKind=row["movement_kind"])
        targets = {identities[payload[key]] for key in row["targets"]
                   if key in payload and payload[key] in identities
                   and identities[payload[key]] in observed_ids}
        if targets:
            result["targetIds"] = sorted(targets)
        return result

    def evaluate(self, entry, local, candidate):
        return self.compiled.evaluate(entry, {"local": local, "candidate": candidate})
