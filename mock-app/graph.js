/* SmartPath graph model. Edges of type "related" are undirected links.
   Other edge types are ignored so a path can never invent a prerequisite. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SmartPathGraphModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RELATED = 'related';

  function nodeIds(graph) {
    const ids = new Set();
    const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
    nodes.forEach(node => { if (node && typeof node.id === 'string') ids.add(node.id); });
    return ids;
  }

  function relatedNeighborIds(graph, id) {
    const known = nodeIds(graph);
    if (!known.has(id)) return [];
    const neighbors = [];
    const seen = new Set();
    const edges = Array.isArray(graph.relationships) ? graph.relationships : [];
    edges.forEach(edge => {
      if (!edge || edge.type !== RELATED) return;
      if (typeof edge.source !== 'string' || typeof edge.target !== 'string') return;
      if (edge.source === edge.target) return;
      let other = '';
      if (edge.source === id) other = edge.target;
      else if (edge.target === id) other = edge.source;
      if (!other || !known.has(other) || seen.has(other)) return;
      seen.add(other);
      neighbors.push(other);
    });
    return neighbors;
  }

  function shortestRelatedPath(graph, from, to) {
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const known = nodeIds(graph);
    if (!known.has(from) || !known.has(to)) return null;
    if (from === to) return [from];
    const queue = [[from]];
    const seen = new Set([from]);
    while (queue.length) {
      const path = queue.shift();
      const tail = path[path.length - 1];
      const neighbors = relatedNeighborIds(graph, tail);
      for (let i = 0; i < neighbors.length; i += 1) {
        const next = neighbors[i];
        if (seen.has(next)) continue;
        const extended = path.concat(next);
        if (next === to) return extended;
        seen.add(next);
        queue.push(extended);
      }
    }
    return null;
  }

  function isRelatedWalk(graph, ids) {
    if (!Array.isArray(ids) || ids.length === 0) return false;
    const known = nodeIds(graph);
    if (!ids.every(id => typeof id === 'string' && known.has(id))) return false;
    for (let i = 1; i < ids.length; i += 1) {
      if (!relatedNeighborIds(graph, ids[i - 1]).includes(ids[i])) return false;
    }
    return true;
  }

  return { RELATED, relatedNeighborIds, shortestRelatedPath, isRelatedWalk };
});
