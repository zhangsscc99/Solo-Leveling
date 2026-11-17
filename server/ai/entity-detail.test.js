// entity-detail 纯函数契约：
//   · extractEntity 命中六类实体词族、未点名返回 null、畸形输入不抛；
//   · detail 每条都含实体名、按计数轮换、同实体连取两次不同文；
//   · entitiesIn 只回报场景正文真实在场的实体。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const entityDetail = require("./entity-detail");

test("extractEntity 命中实体词族", () => {
  assert.equal(entityDetail.extractEntity("我抬头看了看头顶的裂缝"), "裂缝");
  assert.equal(entityDetail.extractEntity("我屏息盯着那排石像"), "石像");
  assert.equal(entityDetail.extractEntity("我伸手摸了摸石碑的底座"), "石碑");
  assert.equal(entityDetail.extractEntity("长明灯的火苗一动不动"), "长明灯");
  assert.equal(entityDetail.extractEntity("我推了推那扇石门"), "石门");
  assert.equal(entityDetail.extractEntity("我凑近壁画想看清人脸"), "壁画");
});

test("extractEntity 未命中/畸形输入返回 null 且不抛", () => {
  assert.equal(entityDetail.extractEntity("我把兜帽拉低"), null);
  assert.equal(entityDetail.extractEntity("我蹲下检查石阶上的刻痕"), null);
  assert.equal(entityDetail.extractEntity(""), null);
  assert.equal(entityDetail.extractEntity(null), null);
  assert.equal(entityDetail.extractEntity(42), null);
});

test("detail 每条含实体名、轮换不重文、未知实体返回 null", () => {
  for (const e of entityDetail.ENTITIES) {
    assert.ok(e.lines.length >= 3, `${e.name} 细节池应 ≥3 条`);
    const a = entityDetail.detail(e.name, 0);
    const b = entityDetail.detail(e.name, 1);
    const c = entityDetail.detail(e.name, 2);
    for (const line of [a, b, c]) {
      assert.ok(line.includes(e.name), `${e.name} 细节句必须含实体名: ${line}`);
    }
    assert.equal(new Set([a, b, c]).size, 3, `${e.name} 三次轮换不得重文`);
    // 回卷：n=len 应等于 n=0
    assert.equal(entityDetail.detail(e.name, e.lines.length), a);
  }
  assert.equal(entityDetail.detail("不存在的物", 0), null);
});

test("entitiesIn 只报在场实体，顺序固定", () => {
  const blob = "长明灯、斑驳壁画，还有一整圈靠墙而立的人形石像。身后的石门合拢了。";
  assert.deepEqual(entityDetail.entitiesIn(blob), ["石像", "长明灯", "石门", "壁画"]);
  assert.deepEqual(entityDetail.entitiesIn("这里什么都没有。"), []);
  assert.deepEqual(entityDetail.entitiesIn(null), []);
});
