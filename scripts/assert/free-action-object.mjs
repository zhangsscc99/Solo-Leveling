#!/usr/bin/env node
// F162 自由行动「动作 + 对象」契约（全是行为断言）：
//
//   (a) 新档发「我蹲下身，捡起地上一枚发烫的碎片」——回包不得含
//       「仔细检查了石像」（或任何「检查了<场景实体>」形态），且必须
//       含「碎片」字样或明确否认（「没有…碎片」）：玩家点名的对象
//       不得被换成场景默认实体。
//   (b) 发「我捡起那把不存在的青铜钥匙」——回包必须含否认词
//       （没有/不见/找不到），且不得把场景实体名替换进答句当作
//       被捡到的东西（「你捡起石像」形态判 FAIL）。
//   (c) 发「我捡起地上的石屑」——回包动词必须是捡/拾/收/揣/拿族，
//       不得是检查/端详/打量：拾取动词不得被归进 inspect 话术。
//   (d) 既有行为不回归：发「我听一听周围的动静」仍得「听」族回应
//       （含「听」字），发「我闻一下空气」仍得气味族回应。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：resolveTarget 退回旧词表命中逻辑 → (a)(b)(c) FAIL；
//   拾取动词回退到 inspect 族 → (a)(c) FAIL；点名非场景物仍换物作答
//   → (a)(b) FAIL；listen/smell 族被新管线吞掉 → (d) FAIL。
import { assert, ok, makeSave, act } from "./_http.mjs";

const id = await makeSave("f162-object");

// ── (a) 点名的「碎片」不得被换成石像，动作不得被答成检查 ──────────────
{
  const r = await act(id, "我蹲下身，捡起地上一枚发烫的碎片");
  const text = r.reply.content;
  assert(
    !/检查了?(石像|石碑|石阶|台阶|祭坛|石柱|石门|长明灯|壁画|石座|光幕|沙地|兽骨|火盆|画像|冰面|刻痕|血迹|四周)/.test(
      text
    ),
    `(a) 回包仍是「检查了<场景实体>」换物话术：${text.slice(-160)}`
  );
  assert(
    text.includes("碎片") || /没有.{0,6}碎片/.test(text),
    `(a) 回包既没有「碎片」也没有对碎片的否认：${text.slice(-160)}`
  );
  console.log(`    (a) 点名「碎片」→ 对象不再被丢弃/替换：${text.split("\n")[0].slice(0, 90)}`);
}

// ── (b) 点名不存在的物 → 明确否认，不得把场景物当捡到的东西 ────────────
{
  const r = await act(id, "我捡起那把不存在的青铜钥匙");
  const text = r.reply.content;
  assert(
    /没有|不见|找不到/.test(text),
    `(b) 点名不存在物却缺否认词（没有/不见/找不到）：${text.slice(-160)}`
  );
  assert(
    !/你(把|将)?.{0,4}(石像|石碑|石阶|台阶|祭坛|石柱|石门|长明灯|壁画|石座|光幕|兽骨|火盆|画像|刻痕|血迹).{0,6}(捡|拾|拿|收|揣|塞|入包|进背包)/.test(
      text
    ) &&
      !/(捡|拾|拿|收|揣)起?了?(那|这|一)?.{0,4}(石像|石碑|石门|长明灯|壁画|祭坛|石柱|兽骨|火盆)/.test(
        text
      ),
    `(b) 场景实体名被替换进答句当作捡到的东西：${text.slice(-160)}`
  );
  console.log(`    (b) 点名「青铜钥匙」（不存在）→ 明确否认：${text.split("\n")[0].slice(0, 90)}`);
}

// ── (c) 拾取动词不得走 inspect 的「检查」话术 ─────────────────────────
{
  const r = await act(id, "我捡起地上的石屑");
  const text = r.reply.content;
  assert(
    /[捡拾收揣拿]/.test(text),
    `(c) 回包里没有捡/拾/收/揣/拿族动词：${text.slice(-160)}`
  );
  assert(
    !/检查|端详|打量/.test(text),
    `(c) 拾取输入被答成检查/端详/打量：${text.slice(-160)}`
  );
  console.log(`    (c)「捡起石屑」→ 拾取动词保留：${text.split("\n")[0].slice(0, 90)}`);
}

// ── (d) 既有词族不回归：听族 + 闻族 ───────────────────────────────────
{
  const r = await act(id, "我听一听周围的动静");
  assert(
    r.reply.content.includes("听"),
    `(d)「听一听」丢了听族回应：${r.reply.content.slice(-160)}`
  );
  const r2 = await act(id, "我闻一下空气");
  assert(
    /闻|嗅|气味|味道|腥|息/.test(r2.reply.content),
    `(d)「闻一下空气」丢了气味族回应：${r2.reply.content.slice(-160)}`
  );
  console.log("    (d) 听族/闻族回应未回归");
}

ok("free-action-object OK");
