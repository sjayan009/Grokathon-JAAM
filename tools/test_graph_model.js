/* Fixture graph walks use related edges only. No prerequisite shortcuts. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const model = require('../mock-app/graph.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../mock-app/fixtures/demo.json'), 'utf8'));
const graph = fixture.graph;

assert.deepStrictEqual(model.relatedNeighborIds(graph, 'memory'), ['addresses']);
assert.deepStrictEqual(model.relatedNeighborIds(graph, 'addresses'), ['memory', 'pointers']);
assert.deepStrictEqual(model.relatedNeighborIds(graph, 'pointers'), ['addresses', 'ldr', 'str']);
assert.deepStrictEqual(model.relatedNeighborIds(graph, 'ldr'), ['pointers']);
assert.deepStrictEqual(model.relatedNeighborIds(graph, 'str'), ['pointers']);
assert.deepStrictEqual(model.relatedNeighborIds(graph, 'not-a-concept'), []);

assert.strictEqual(model.isRelatedWalk(graph, ['memory', 'addresses', 'pointers']), true);
assert.strictEqual(model.isRelatedWalk(graph, ['pointers', 'addresses', 'memory']), true);
assert.strictEqual(model.isRelatedWalk(graph, ['memory', 'pointers']), false);
assert.strictEqual(model.isRelatedWalk(graph, ['memory', 'ldr']), false);
assert.strictEqual(model.isRelatedWalk(graph, []), false);
assert.strictEqual(model.isRelatedWalk(graph, ['missing']), false);

assert.deepStrictEqual(
  model.shortestRelatedPath(graph, 'memory', 'ldr'),
  ['memory', 'addresses', 'pointers', 'ldr']
);
assert.deepStrictEqual(
  model.shortestRelatedPath(graph, 'memory', 'str'),
  ['memory', 'addresses', 'pointers', 'str']
);
assert.deepStrictEqual(model.shortestRelatedPath(graph, 'ldr', 'ldr'), ['ldr']);
assert.strictEqual(model.shortestRelatedPath(graph, 'memory', 'not-a-concept'), null);

const poisoned = JSON.parse(JSON.stringify(graph));
poisoned.relationships.push({source: 'memory', target: 'ldr', type: 'prerequisite'});
assert.strictEqual(model.isRelatedWalk(poisoned, ['memory', 'ldr']), false);
assert.deepStrictEqual(
  model.shortestRelatedPath(poisoned, 'memory', 'ldr'),
  ['memory', 'addresses', 'pointers', 'ldr']
);

const ids = new Set(graph.nodes.map(node => node.id));
graph.relationships.forEach(edge => {
  assert.strictEqual(edge.type, 'related');
  assert.ok(ids.has(edge.source) && ids.has(edge.target));
});

console.log('PASS: related-only graph walks for memory, addresses, pointers, ldr, str');
