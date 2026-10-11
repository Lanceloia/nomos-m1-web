// Derived from the accepted core-rescue witness, outside the world definitions.
export interface CapsuleStep {
  entry: string;
  stage: string;
  reason: string;
  destination?: string;
  resident?: boolean;
  optional?: boolean;
}

const move = (destination: string, stage: string, reason: string): CapsuleStep =>
  ({ entry: 'move_adventurer', destination, stage, reason });
const cross = (destination: string, stage: string, reason: string): CapsuleStep =>
  ({ entry: 'cross_ice_adventurer', destination, stage, reason });
const action = (entry: string, stage: string, reason: string): CapsuleStep => ({ entry, stage, reason });
const floor = (stage: string): CapsuleStep[] => [
  action('observe_floor_adventurer', stage, '查看脚下地面，为接下来的通行作准备。'),
  { ...action('thaw_floor_adventurer', stage, '融开眼前的冰面，让接下来的通行更稳妥。'), optional: true },
];
const routes = (stage: string) => action('observe_routes_adventurer', stage, '看看附近通向哪里。');

export const CORE_CAPSULE: readonly CapsuleStep[] = [
  cross('ritual_passage_entry', '赶往仪式处', '先尝试穿过冰面，前往仪式方向。'),
  move('ritual_threshold', '赶往仪式处', '继续走向仪式门槛。'),
  move('ritual_ring', '赶往仪式处', '靠近仪式，寻找中断它的机会。'),
  action('carry_from_ritual_adventurer', '中断仪式', '先把居民搬离仪式圈。'),
  action('observe_routes_adventurer', '寻找补给', '先寻找补给，为回来照看居民作准备。'),
  move('ritual_passage_entry', '寻找补给', '返回舞厅方向，寻找补给。'),
  cross('ballroom_entrance', '寻找补给', '回到舞厅入口。'),
  routes('寻找补给'),
  cross('ballroom_chandelier_reach', '寻找补给', '靠近吊灯，看看这里有什么。'),
  action('observe_chandelier_adventurer', '寻找补给', '仔细查看吊灯与附近的人。'),
  action('detach_reservoir_adventurer', '寻找补给', '取下眼前可拆卸的储能器。'),
  ...floor('补充永焰'),
  action('reload_everflame_adventurer', '补充永焰', '用随身储能器为永焰补充一点充能。'),
  routes('返回居民身边'),
  cross('ballroom_entrance', '返回居民身边', '先回到舞厅入口。'),
  cross('ritual_passage_entry', '返回居民身边', '返回仪式方向，照看先前搬出的居民。'),
  move('ritual_threshold', '返回居民身边', '回到仪式门槛。'),
  { ...action('observe_resident_adventurer', '照看居民', '查看先前搬出的居民现在怎么样。'), resident: true },
  { ...action('thaw_person_adventurer', '照看居民', '用永焰解冻眼前的居民。'), resident: true },
  action('offer_escort_adventurer', '邀请同行', '邀请附近居民一起离开。'),
  move('ritual_passage_entry', '寻找出宫的路', '先返回舞厅方向。'),
  cross('ballroom_entrance', '寻找出宫的路', '回到舞厅入口。'),
  move('halls_ballroom_door', '寻找出宫的路', '进入大厅，继续寻找出宫的路。'),
  routes('寻找出宫的路'),
  cross('halls_bridge_door', '寻找出宫的路', '尝试穿过大厅冰面。'),
  routes('前往桥面'),
  move('bridge_palace_landing', '前往桥面', '走到眼前的桥头。'),
  routes('稳妥过桥'),
  ...floor('稳妥过桥'),
  { ...action('bridge_slow_adventurer', '稳妥过桥', '慢行到桥中段。'), destination: 'bridge_midspan' },
  routes('稳妥过桥'),
  ...floor('稳妥过桥'),
  { ...action('bridge_slow_adventurer', '稳妥过桥', '慢行到外岸。'), destination: 'palace_exit' },
  ...Array.from({ length: 8 }, () => action('wait_adventurer', '在外岸等候', '在外岸稍作等候，留意同行居民的动静。')),
  action('leave_palace_adventurer', '结束旅程', '准备好后，离开宫殿。'),
];
