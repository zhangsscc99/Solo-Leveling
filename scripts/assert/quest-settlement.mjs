#!/usr/bin/env node
// F080 任务进度与输入正则解耦：
//   (a) 新档无敌人状态下连续 3 次输入含「攻击」语义的自由文本——任务面板
//       daily_hunt.progress 仍为 0、saves.kills 仍为 0（打字不算击杀）；
//       注：自由文本只会走 attack 意图的「空挥/掷遭遇」分支，遭遇真的刷出
//       敌人时后续输入才进入真实回合——ch1 小怪 HP≥61，Lv1 两刀砍不死，
//       因此三次输入内 kills 必为 0，断言是确定性的。
//   (b) 真实打完一场并击杀敌人 → daily_hunt.progress 恰好 +1（不跳 2）；
//   (c) 「释放技能 不存在技能」被诚实拒绝且 daily_skill（力量校准）不推进；
//   (d) 同一击杀不得重复计数：再拉一次任务面板 progress 不变。
import { makeSave, act, get, fetchSaveView, assert, ok } from "./_http.mjs";

async function dailyQuest(id, questId) {
  const { status, body } = await get(`/saves/${id}/quests`);
  assert(status === 200 && body && Array.isArray(body.daily), `GET quests failed (HTTP ${status})`);
  const q = body.daily.find((d) => d.id === questId);
  assert(q, `quest ${questId} missing from daily view`);
  return q;
}

// ── (a) 空挥攻击文本不推进「今日狩猎」──────────────────────────────
{
  const id = await makeSave("f080-swing");
  const texts = ["我挥刀砍向石像", "我拔刀斩杀四周的黑暗", "攻击！把挡路的都干掉"];
  for (const t of texts) {
    const r = await act(id, t);
    // 若自由文本掷中了真实遭遇，敌我是真的——但剩下的 ≤2 刀在 Lv1 打
    // 不穿 ch1 小怪（HP≥61），kills 仍然必为 0。
    if (r.save.combat) assert(r.save.kills === 0, "spawned enemy died without combat");
  }
  const { save } = await fetchSaveView(id);
  assert(save.kills === 0, `(a) kills must stay 0 after pure text swings, got ${save.kills}`);
  const hunt = await dailyQuest(id, "daily_hunt");
  assert(
    hunt.progress.current === 0 && hunt.status !== "done",
    `(a) daily_hunt advanced by text input: ${JSON.stringify(hunt.progress)}`
  );
  console.log("(a) text swings: kills=0 daily_hunt=0 OK");
}

// ── (b)+(d) 真实击杀恰好 +1、不重复计数 ────────────────────────────
{
  const id = await makeSave("f080-kill");

  // 先掷出一场真实遭遇（保底 ≤10 次攻击必中）。
  let cur = null;
  for (let i = 0; i < 10; i++) {
    cur = await act(id, "攻击");
    if (cur.save.combat) break;
  }
  assert(cur && cur.save.combat, "(b) setup: no encounter within 10 attacks");

  const huntBefore = await dailyQuest(id, "daily_hunt");
  const killsBefore = cur.save.kills;

  // 打到交战收敛：残血优先嗑药，纯「攻击」结算每一回合。
  let killReply = null;
  for (let i = 0; i < 60; i++) {
    const inCombat = Boolean(cur.save.combat);
    const low = inCombat && cur.save.hp > 0 && cur.save.hp < Math.max(35, cur.save.max_hp * 0.3);
    cur = await act(id, low ? "使用道具" : "攻击");
    if (!cur.save.combat) {
      killReply = cur.reply.content;
      break;
    }
  }
  assert(killReply !== null, "(b) combat never converged within 60 turns");
  assert(/击败/.test(killReply), `(b) combat ended without a kill: ${killReply.slice(-160)}`);
  assert(cur.save.kills === killsBefore + 1, `(b) kills ${killsBefore} -> ${cur.save.kills}`);

  const huntAfter = await dailyQuest(id, "daily_hunt");
  assert(
    huntAfter.progress.current === huntBefore.progress.current + 1,
    `(b) daily_hunt ${huntBefore.progress.current} -> ${huntAfter.progress.current} (must be exactly +1)`
  );
  console.log(`(b) real kill: daily_hunt ${huntBefore.progress.current}->${huntAfter.progress.current} OK`);

  // (d) 同一击杀不重复计数：反复拉面板 + 再空挥几次，progress 不动。
  const again1 = await dailyQuest(id, "daily_hunt");
  assert(
    again1.progress.current === huntAfter.progress.current,
    `(d) recount on refetch: ${huntAfter.progress.current} -> ${again1.progress.current}`
  );
  for (let i = 0; i < 3; i++) {
    const r = await act(id, "我挥刀砍向石像");
    assert(r.save.kills === cur.save.kills, `(d) post-kill swing granted a kill: ${cur.save.kills} -> ${r.save.kills}`);
  }
  const again2 = await dailyQuest(id, "daily_hunt");
  assert(
    again2.progress.current === huntAfter.progress.current,
    `(d) recount after extra swings: ${huntAfter.progress.current} -> ${again2.progress.current}`
  );
  console.log("(d) no double counting on refetch/extra swings OK");
}

// ── (c) 不存在的技能被拒绝且不推进「力量校准」──────────────────────
{
  const id = await makeSave("f080-skill");
  const before = await dailyQuest(id, "daily_skill");
  const r = await act(id, "释放技能 不存在技能");
  assert(
    /不存在|无法|未习得/.test(r.reply.content),
    `(c) bogus skill must be refused honestly, got: ${r.reply.content.slice(0, 140)}`
  );
  const after = await dailyQuest(id, "daily_skill");
  assert(
    after.progress.current === before.progress.current && after.status !== "done",
    `(c) daily_skill advanced by rejected skill: ${JSON.stringify(after.progress)}`
  );
  const { save } = await fetchSaveView(id);
  assert(save.mp === save.max_mp, `(c) rejected skill must not burn MP: ${save.mp}/${save.max_mp}`);
  console.log("(c) bogus skill refused, daily_skill unchanged OK");
}

ok("F080 quest-settlement: all assertions passed");
