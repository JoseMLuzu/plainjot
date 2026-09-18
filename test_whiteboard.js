const assert = require("node:assert/strict");
const { test } = require("node:test");
const { empty, parse, serialize, validate, toSVG, hitTest, History } = require("./static/whiteboard.js");
const pen = { type: "pen", color: "#294438", size: 4, points: [[10, 10], [100, 100]] };

test("whiteboard Markdown roundtrips all four drawing elements", () => {
  const board = empty();
  board.elements.push(pen, { type: "rect", color: "#30343b", size: 2, start: [200, 200], end: [400, 400] },
    { type: "arrow", color: "#3269a8", size: 8, start: [400, 300], end: [600, 300] },
    { type: "text", color: "#bc5149", size: 4, start: [200, 50], text: "API\nDatabase" });
  assert.deepEqual(parse(serialize(board)), board);
  assert.ok(toSVG(board).includes("<tspan"));
});

test("unsupported or malformed files never silently become empty boards", () => {
  for (const body of ["", "normal note", "```plainjot-whiteboard\n{broken\n```", "```plainjot-whiteboard\n{}\n```", serialize(empty()).replace('"version":1', '"version":2')]) {
    assert.throws(() => parse(body));
  }
});

test("validation rejects executable geometry, invalid coordinates and oversized data", () => {
  for (const element of [{ ...pen, type: "script" }, { ...pen, color: 'red" onload="alert(1)' }, { ...pen, size: -1 },
    { ...pen, points: [[-1, 4]] }, { ...pen, points: [[Infinity, 0]] }, { ...pen, points: [["20", 1]] },
    { ...pen, points: Array(4001).fill([1, 1]) }, { ...pen, points: [] },
    { type: "text", color: "#294438", size: 4, start: [0, 0], text: "a".repeat(1001) }]) {
    assert.throws(() => validate({ ...empty(), elements: [element] }));
  }
  assert.throws(() => validate({ ...empty(), elements: Array(501).fill(pen) }));
  assert.throws(() => validate({ ...empty(), elements: Array(6).fill({ ...pen, points: Array(4000).fill([1, 1]) }) }));
});

test("SVG export escapes agent-created text and title without executable markup", () => {
  const board = { ...empty(), elements: [{ type: "text", color: "#30343b", size: 4, start: [10, 10], text: '<script>alert("x")</script> & test' }] };
  const svg = toSVG(board, '<img onerror="evil">');
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&lt;img"));
  assert.ok(!svg.includes("<script"));
  assert.ok(!svg.includes("<img"));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
});

test("undo and redo restore deletions, reject invalid changes, and reset on external reload", () => {
  const history = new History();
  assert.equal(history.undo(), false);
  history.commit({ ...empty(), elements: [pen] });
  history.commit(empty());
  history.undo(); assert.equal(history.board.elements.length, 1);
  history.redo(); assert.equal(history.board.elements.length, 0);
  assert.throws(() => history.commit({}));
  history.undo(); history.commit({ ...empty(), elements: [{ ...pen, size: 2 }] });
  assert.equal(history.redo(), false);
  history.reset(empty()); assert.equal(history.undo(), false);
});

test("eraser hit testing targets strokes and outlines, not rectangle interiors", () => {
  assert.equal(hitTest(pen, [50, 50]), true);
  assert.equal(hitTest(pen, [150, 20]), false);
  const rect = { type: "rect", color: "#30343b", size: 2, start: [200, 200], end: [400, 400] };
  assert.equal(hitTest(rect, [205, 300]), true);
  assert.equal(hitTest(rect, [300, 300]), false);
});
