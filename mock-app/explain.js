/* Fixture-backed passage explanations.
   User text chooses an anchor id and a reformulation. Narration is copied
   from the explanation fixture. PDF quotes are evidence, never instructions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SmartPathExplain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REFORMULATIONS = ['default', 'simpler', 'example', 'relationship'];
  const NEEDS_SELECTION = 'Select a highlighted passage, then ask again. I will not guess a location.';
  const UNGROUNDED = 'I can explain this, but I couldn\'t pinpoint that in this document. I will not invent a passage or a highlight. This mock does not call Grok.';

  function normalize(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function reformulationOf(lower) {
    if (/\b(simpler|more simple|explain simply|easier)\b/.test(lower)) return 'simpler';
    if (/\bexample\b/.test(lower)) return 'example';
    if (/\b(relationship|related concept|show the graph|show relationship)\b/.test(lower)) return 'relationship';
    return 'default';
  }

  function classifyUtterance(text) {
    const lower = normalize(text);
    if (!lower) return {intent: 'unsupported', reformulation: 'default'};
    if (/^(stop|cancel)\b/.test(lower) || (/\b(stop|cancel)\b/.test(lower) && !/\b(explain|what|why|how)\b/.test(lower))) {
      return {intent: 'stop', reformulation: 'default'};
    }
    if (/^pause\b/.test(lower) || (/\bpause\b/.test(lower) && !/\b(explain|what|why)\b/.test(lower))) {
      return {intent: 'pause', reformulation: 'default'};
    }
    if (/^(resume|continue)\b/.test(lower)) return {intent: 'resume', reformulation: 'default'};
    if (/\b(quiz|test me|check understanding)\b/.test(lower)) return {intent: 'quiz_me', reformulation: 'default'};
    if (/\b(review|weak|study next)\b/.test(lower)) return {intent: 'review_weaknesses', reformulation: 'default'};
    if (/\bshow related\b|\brelated concepts\b/.test(lower)) return {intent: 'show_related', reformulation: 'default'};
    if (/\b(teach|walk me|start lesson|from scratch)\b/.test(lower) && !/\b(explain this|what does|why does)\b/.test(lower)) {
      return {intent: 'teach_concept', reformulation: 'default'};
    }
    const reformulation = reformulationOf(lower);
    if (reformulation !== 'default' || /\b(explain|what does|what is|why|how does|how do)\b/.test(lower)) {
      return {intent: 'explain_selection', reformulation: reformulation};
    }
    if (/\bldr\b/.test(lower)) return {intent: 'teach_concept', reformulation: 'default'};
    return {intent: 'unsupported', reformulation: 'default'};
  }

  function isDeictic(lower) {
    return /\b(this|that|it|these|those|here|selection|passage|highlight)\b/.test(lower);
  }

  function passageText(passage, reformulation) {
    switch (reformulation) {
      case 'simpler':
        return passage.simpler;
      case 'example':
        return passage.example;
      case 'relationship':
        return passage.relationship;
      case 'default':
        return passage.default;
      default:
        return null;
    }
  }

  function copyRects(rects) {
    if (!Array.isArray(rects)) return [];
    return rects.map(function (rect) {
      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
    });
  }

  function ungrounded(reason, reformulation) {
    const text = reason === 'needs_selection' ? NEEDS_SELECTION : UNGROUNDED;
    return {
      grounded: false,
      intent: 'explain_selection',
      reformulation: reformulation || 'default',
      reason: reason,
      anchorId: null,
      conceptId: null,
      pageIndex: null,
      pageLabel: null,
      captionTitle: 'No source match',
      text: text,
      speechText: text,
      evidence: [],
      nextActions: [],
      source: 'fixture'
    };
  }

  function findAnchor(fixture, id) {
    const anchors = fixture && Array.isArray(fixture.anchors) ? fixture.anchors : [];
    for (let i = 0; i < anchors.length; i += 1) {
      if (anchors[i].id === id) return anchors[i];
    }
    return null;
  }

  function findNode(fixture, id) {
    const nodes = fixture && fixture.graph && Array.isArray(fixture.graph.nodes) ? fixture.graph.nodes : [];
    for (let i = 0; i < nodes.length; i += 1) {
      if (nodes[i].id === id) return nodes[i];
    }
    return null;
  }

  function findByQuote(fixture, utterance) {
    const hay = normalize(utterance);
    let best = null;
    const anchors = fixture.anchors || [];
    for (let i = 0; i < anchors.length; i += 1) {
      const quote = normalize(anchors[i].quote);
      if (quote.length < 8 || hay.indexOf(quote) === -1) continue;
      if (!best || quote.length > best.length) best = {anchor: anchors[i], length: quote.length};
    }
    return best ? best.anchor : null;
  }

  function findByAlias(fixture, utterance) {
    const hay = normalize(utterance);
    const passages = fixture.explanations && fixture.explanations.passages;
    if (!passages) return null;
    let best = null;
    Object.keys(passages).forEach(function (id) {
      const aliases = passages[id].aliases || [];
      aliases.forEach(function (alias) {
        const needle = normalize(alias);
        if (needle.length < 6 || hay.indexOf(needle) === -1) return;
        if (!best || needle.length > best.length) best = {id: id, length: needle.length};
      });
    });
    return best ? findAnchor(fixture, best.id) : null;
  }

  function findByConcept(fixture, utterance) {
    const hay = normalize(utterance);
    const nodes = fixture.graph && fixture.graph.nodes ? fixture.graph.nodes.slice() : [];
    nodes.sort(function (a, b) { return b.id.length - a.id.length; });
    for (let i = 0; i < nodes.length; i += 1) {
      const id = nodes[i].id.toLowerCase();
      if (new RegExp('\\b' + id + '\\b').test(hay)) return nodes[i];
      if (id === 'pointers' && /\bpointers?\b/.test(hay)) return nodes[i];
    }
    return null;
  }

  function groundedFromAnchor(fixture, anchor, reformulation) {
    const passages = fixture.explanations && fixture.explanations.passages;
    const passage = passages && passages[anchor.id];
    const text = passage ? passageText(passage, reformulation) : null;
    if (!passage || typeof text !== 'string' || !text.trim()) return ungrounded('missing_fixture_text', reformulation);
    const node = findNode(fixture, anchor.conceptId);
    const pageNumber = anchor.pageIndex + 1;
    const pageLabel = 'Page ' + pageNumber;
    const label = node && node.label ? node.label : 'Source';
    return {
      grounded: true,
      intent: 'explain_selection',
      reformulation: reformulation,
      reason: 'source_anchor',
      anchorId: anchor.id,
      conceptId: anchor.conceptId,
      pageIndex: anchor.pageIndex,
      pageLabel: pageLabel,
      captionTitle: pageLabel + ' · ' + label,
      text: text,
      speechText: pageLabel + '. ' + text,
      evidence: [{
        documentId: anchor.documentId,
        anchorId: anchor.id,
        conceptId: anchor.conceptId,
        pageIndex: anchor.pageIndex,
        quote: anchor.quote,
        rects: copyRects(anchor.rects),
        extractionMethod: anchor.extractionMethod,
        confidence: anchor.confidence
      }],
      nextActions: ['simpler', 'example', 'show_relationship'],
      source: 'fixture'
    };
  }

  function resolveAnchor(fixture, utterance, selectedAnchorId, reformulation) {
    const lower = normalize(utterance);
    const quoted = utterance ? findByQuote(fixture, utterance) : null;
    if (quoted) return quoted;
    const aliased = utterance ? findByAlias(fixture, utterance) : null;
    if (aliased) return aliased;
    const selected = selectedAnchorId ? findAnchor(fixture, selectedAnchorId) : null;
    if (selected && (isDeictic(lower) || reformulation !== 'default')) return selected;
    const concept = utterance ? findByConcept(fixture, utterance) : null;
    if (concept && concept.anchorId) return findAnchor(fixture, concept.anchorId);
    if (selected && isDeictic(lower)) return selected;
    return null;
  }

  function explainAnchor(args) {
    const fixture = args.fixture || {};
    const reformulation = REFORMULATIONS.indexOf(args.reformulation) === -1 ? 'default' : args.reformulation;
    const anchor = findAnchor(fixture, args.anchorId);
    if (!anchor) return ungrounded('unknown_anchor', reformulation);
    return groundedFromAnchor(fixture, anchor, reformulation);
  }

  function explainUtterance(args) {
    const fixture = args.fixture || {};
    const utterance = String(args.utterance || '');
    const decision = classifyUtterance(utterance);
    const requested = args.reformulation || decision.reformulation;
    const reformulation = REFORMULATIONS.indexOf(requested) === -1 ? 'default' : requested;
    const lower = normalize(utterance);
    let anchor = resolveAnchor(fixture, utterance, args.selectedAnchorId, reformulation);
    if (!anchor && isDeictic(lower)) anchor = findAnchor(fixture, 'ldr_instruction');
    if (!anchor) {
      return ungrounded(isDeictic(lower) ? 'needs_selection' : 'unknown_topic', reformulation);
    }
    return groundedFromAnchor(fixture, anchor, reformulation);
  }

  function pageMentioned(text, pageIndex) {
    const pageNumber = String(pageIndex + 1);
    return new RegExp('page\\s*' + pageNumber + '\\b', 'i').test(text);
  }

  function acceptLiveExplanation(live, fixture, fixtureResult) {
    if (!fixtureResult || !fixtureResult.grounded) return null;
    if (!live || typeof live.text !== 'string') return null;
    const text = live.text.trim();
    if (!text || text.length > 600) return null;
    if (/<script|javascript:|<\/?[a-z]/i.test(text)) return null;
    const quote = fixtureResult.evidence[0] && fixtureResult.evidence[0].quote;
    if (!quote || text.indexOf(quote) === -1) return null;
    if (!pageMentioned(text, fixtureResult.pageIndex)) return null;
    if (live.anchorId && live.anchorId !== fixtureResult.anchorId) return null;
    const anchor = findAnchor(fixture, fixtureResult.anchorId);
    if (!anchor || anchor.pageIndex !== fixtureResult.pageIndex) return null;
    const accepted = groundedFromAnchor(fixture, anchor, fixtureResult.reformulation);
    accepted.text = text;
    accepted.speechText = pageMentioned(text, anchor.pageIndex) ? text : ('Page ' + (anchor.pageIndex + 1) + '. ' + text);
    accepted.source = 'live';
    accepted.evidence = [{
      documentId: anchor.documentId,
      anchorId: anchor.id,
      conceptId: anchor.conceptId,
      pageIndex: anchor.pageIndex,
      quote: anchor.quote,
      rects: copyRects(anchor.rects),
      extractionMethod: anchor.extractionMethod,
      confidence: anchor.confidence
    }];
    return accepted;
  }

  return {
    REFORMULATIONS: REFORMULATIONS,
    NEEDS_SELECTION: NEEDS_SELECTION,
    UNGROUNDED: UNGROUNDED,
    classifyUtterance: classifyUtterance,
    explainAnchor: explainAnchor,
    explainUtterance: explainUtterance,
    acceptLiveExplanation: acceptLiveExplanation
  };
});
