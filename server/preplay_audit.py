"""Check selected M1 presentation contracts without compiling or starting a world."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

import yaml

from server.runtime import WORLD_BUNDLE


def read_bundle(path):
    path = Path(path).resolve()
    root = path.parent
    files = {}

    def read(relative):
        selected = (root / relative).resolve()
        if not selected.is_relative_to(root):
            raise ValueError(f'Bundle dependency escapes world directory: {relative}')
        if relative in files:
            raise ValueError(f'Duplicate bundle dependency: {relative}')
        data = selected.read_bytes()
        files[relative] = sha256(data).hexdigest()
        document = yaml.load(data, Loader=yaml.CSafeLoader if hasattr(yaml, 'CSafeLoader') else yaml.SafeLoader)
        if not isinstance(document, dict):
            raise ValueError(f'Expected a YAML mapping: {relative}')
        return document

    manifest = read(path.name)
    if manifest.get('schema') != 'c0.source_bundle.v1':
        raise ValueError('Expected the current C0 source bundle')
    lib = read(manifest['lib'])
    read(manifest['ports'])
    read(manifest['assets'])
    parts = manifest['source_parts']
    if not isinstance(parts, list) or not parts:
        raise ValueError('Source parts must be a non-empty list')
    source = {}
    for relative in parts:
        for key, value in read(relative).items():
            if key in source:
                if not isinstance(value, list) or not isinstance(source[key], list):
                    raise ValueError(f'Conflicting source section: {key}')
                source[key].extend(value)
            else:
                source[key] = value
    return lib, source, files


def inspect_contracts(lib, source):
    findings = []

    def record(code, status, evidence, change):
        findings.append(dict(code=code, status=status, evidence=evidence, suggestedChange=change))

    walls = [row for row in lib.get('records', []) if row.get('name') == 'KnownWall']
    fields = {row['name'] for row in walls[0]['fields']} if len(walls) == 1 else set()
    if not {'individual', 'observed_ref'} <= fields:
        record('wall-record', 'error', sorted(fields), '先恢复冰墙身份与观察来源字段，才能接入Web读回。')
    elif fields == {'individual', 'observed_ref'}:
        record('wall-detail', 'gap', sorted(fields), '需要真实观察产生有限墙况记录；不能从隐藏状态补详情。')
    else:
        record('wall-detail', 'review', sorted(fields), '新增字段不自动证明已有墙况观察；须核对真实写入与玩家读回。')

    seats = [row for row in source.get('seats', []) if row.get('actor') == 'adventurer']
    if len(seats) != 1:
        record('player-seat', 'error', len(seats), '当前Web投影需要唯一的冒险者席位。')
    else:
        seat = seats[0]
        for field in ['adventurer.known_walls', 'adventurer.known_residents', 'adventurer.conversations.visible_motions']:
            if field not in seat.get('read', []):
                record('player-read', 'error', field, '先声明本人读取权限，再投影这个记录。')
        previews = [row.get('entry') for row in seat.get('offer_previews', [])]
        record('public-cost', 'review', previews,
               '预告绑定不等于公开费用接口。承诺耗时前，须核对实际输出与公开依赖。')

    domain_rows = source.get('actor_domains', [])
    hall_domains = [row for row in domain_rows if row['name'] == 'hall_bokolds']
    if len(hall_domains) != 1:
        record('hall-domain', 'error', len(hall_domains), '大厅目标域须明确且唯一；缺少声明不能当作空域通过检查。')
    heard = [row for row in source.get('events', []) if row.get('family') == 'escort_heard']
    hearing_domains = [row for row in domain_rows if len(heard) == 1 and row['name'] == heard[0].get('actor_domain')]
    if len(heard) != 1 or len(hearing_domains) != 1:
        record('escort-domain', 'error', heard, '护送听闻须绑定到已明确声明的Actor域。')
    elif len(hall_domains) == 1:
        omitted = sorted(set(hall_domains[0]['owners']) - set(hearing_domains[0]['owners']))
        if omitted:
            record('hall-invitation', 'gap', omitted, '大厅居民不在该听闻域；不能宣称听见或答复，真实听闻与回应须另建规则。')
    record('resident-reply', 'review', ['escort_heard'],
           '听闻不等于答复。显示同意或拒绝前，须人工核对NPC发话与玩家听见链。')
    return findings


def audit(path):
    lib, source, files = read_bundle(path)
    findings = inspect_contracts(lib, source)
    return {'kind': 'static-contract-audit', 'worldBundle': str(Path(path).resolve()),
            'worldHashes': files, 'compileCount': 0, 'sessions': 0, 'actions': 0,
            'findings': findings, 'structuralChecksPassed': not any(row['status'] == 'error' for row in findings)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=WORLD_BUNDLE)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        report = audit(args.bundle)
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError) as error:
        print(f'静态输入检查失败：{error}')
        return 2
    labels = {'error': '错误', 'gap': '功能缺口', 'review': '需核查'}
    for row in report['findings']:
        print(f"[{labels[row['status']]}] {row['code']}: {row['evidence']}")
        print('  ' + row['suggestedChange'])
    print(f"已读 {len(report['worldHashes'])} 份作者文件；未 Compile、未开局、未执行行动。")
    print('结构检查通过不代表功能缺口关闭或体验通过。')
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if report['structuralChecksPassed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
