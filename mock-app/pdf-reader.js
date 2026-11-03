/* PDF study reader for the bundled raster pages.
   Coordinates: fixture rects are fractions of the PDF page, origin top-left, y down
   (the same box PyMuPDF page.rect uses). Highlights and hotspots are children of the
   page element, so zoom and scroll move them with the page. Screen pixels are measured
   after layout; they are never stored as the source of truth.
   Public contract: window.PdfViewerApi. See PDF_VIEWER_API.md. */
(() => {
  const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2];
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;

  const state = {
    fixture: null,
    zoom: 1,
    selectedAnchorId: null,
    listeners: {},
    layoutEpoch: 0,
    chromeBound: false
  };

  const $ = (id) => document.getElementById(id);

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollBehavior(requested) {
    if (reducedMotion()) return 'auto';
    return requested === 'auto' || requested === 'smooth' ? requested : 'smooth';
  }

  function clampZoom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return state.zoom;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 1000) / 1000));
  }

  function pageElement(pageIndex) {
    return document.getElementById(`page-${pageIndex}`);
  }

  function hotspotElement(anchorId) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(anchorId || ''))) return null;
    const matches = document.querySelectorAll(`[data-anchor-id="${CSS.escape(anchorId)}"]`);
    return matches.length === 1 ? matches[0] : null;
  }

  function rectNumbers(rect) {
    if (!rect || typeof rect !== 'object') return null;
    const x = Number(rect.x);
    const y = Number(rect.y);
    const width = Number(rect.width);
    const height = Number(rect.height);
    if (![x, y, width, height].every(Number.isFinite)) return null;
    if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
    if (x > 1 || y > 1 || x + width > 1.001 || y + height > 1.001) return null;
    return {x, y, width, height};
  }

  function trustworthyRects(rects) {
    if (!Array.isArray(rects) || rects.length === 0) return false;
    return rects.every(rect => rectNumbers(rect) !== null);
  }

  function knownAnchor(anchorOrId) {
    if (!state.fixture) return null;
    const id = typeof anchorOrId === 'string' ? anchorOrId : anchorOrId && anchorOrId.id;
    if (typeof id !== 'string' || !id) return null;
    return state.fixture.anchors.find(anchor => anchor.id === id) || null;
  }

  function contentBox(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    return {
      left: rect.left + borderLeft + paddingLeft,
      top: rect.top + borderTop + paddingTop,
      width: rect.width - borderLeft - borderRight - paddingLeft - paddingRight,
      height: rect.height - borderTop - borderBottom - paddingTop - paddingBottom
    };
  }

  function boxFrom(pageBox, rect) {
    return {
      x: pageBox.left + rect.x * pageBox.width,
      y: pageBox.top + rect.y * pageBox.height,
      width: rect.width * pageBox.width,
      height: rect.height * pageBox.height,
      left: pageBox.left + rect.x * pageBox.width,
      top: pageBox.top + rect.y * pageBox.height,
      right: pageBox.left + (rect.x + rect.width) * pageBox.width,
      bottom: pageBox.top + (rect.y + rect.height) * pageBox.height
    };
  }

  function applyRect(element, rect) {
    element.style.left = `${rect.x * 100}%`;
    element.style.top = `${rect.y * 100}%`;
    element.style.width = `${rect.width * 100}%`;
    element.style.height = `${rect.height * 100}%`;
  }

  function writeRectData(element, rect) {
    element.dataset.rectX = String(rect.x);
    element.dataset.rectY = String(rect.y);
    element.dataset.rectWidth = String(rect.width);
    element.dataset.rectHeight = String(rect.height);
  }

  function dispatchPdf(type, detail) {
    const payload = {
      type,
      zoom: state.zoom,
      layoutEpoch: state.layoutEpoch,
      documentId: state.fixture ? state.fixture.document.id : null,
      ...detail
    };
    window.dispatchEvent(new CustomEvent('smartpath:pdf', {detail: payload}));
    return payload;
  }

  function pagePixelSize(page) {
    return {width: page.width * state.zoom, height: page.height * state.zoom};
  }

  function renderPages() {
    const wrap = $('pdf-pages');
    wrap.replaceChildren();
    const pageCount = state.fixture.pages.length;
    state.fixture.pages.forEach(page => {
      const size = pagePixelSize(page);
      const container = document.createElement('article');
      container.className = 'pdf-page-wrap';
      container.id = `page-${page.pageIndex}`;
      container.dataset.pageIndex = String(page.pageIndex);
      container.dataset.pageWidth = String(page.width);
      container.dataset.pageHeight = String(page.height);
      container.style.width = `${size.width}px`;
      container.style.height = `${size.height}px`;
      container.setAttribute('aria-label', `PDF page ${page.pageIndex + 1} of ${pageCount}`);

      const image = document.createElement('img');
      image.src = page.image;
      image.alt = `Actual rendered PDF page ${page.pageIndex + 1}`;
      image.draggable = false;
      container.append(image);

      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      layer.setAttribute('class', 'pdf-annotation-layer');
      layer.dataset.annotationLayer = String(page.pageIndex);
      layer.setAttribute('viewBox', '0 0 1 1');
      layer.setAttribute('width', '100%');
      layer.setAttribute('height', '100%');
      layer.setAttribute('preserveAspectRatio', 'none');
      layer.setAttribute('aria-hidden', 'true');
      container.append(layer);

      state.fixture.anchors.filter(anchor => anchor.pageIndex === page.pageIndex).forEach(anchor => {
        anchor.rects.forEach((rect, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'pdf-anchor';
          button.dataset.pageIndex = String(anchor.pageIndex);
          button.dataset.anchorConcept = anchor.conceptId;
          writeRectData(button, rect);
          applyRect(button, rect);
          if (index === 0) {
            button.dataset.anchorId = anchor.id;
            button.dataset.active = 'false';
            button.dataset.quote = anchor.quote;
            button.setAttribute('aria-label', `Highlight source passage: ${anchor.quote}`);
            button.setAttribute('aria-pressed', 'false');
          } else {
            button.classList.add('pdf-anchor-extra');
            button.dataset.anchorHit = anchor.id;
            button.tabIndex = -1;
            button.setAttribute('aria-hidden', 'true');
          }
          button.addEventListener('click', event => {
            if (typeof state.listeners.onAnchorClick === 'function') {
              state.listeners.onAnchorClick(anchor, event);
              return;
            }
            highlightAnchor(anchor.id, {scroll: true});
          });
          container.append(button);
        });
      });

      const sticker = document.createElement('span');
      sticker.className = 'page-sticker';
      sticker.textContent = `${page.pageIndex + 1} / ${pageCount}`;
      container.append(sticker);
      wrap.append(container);
    });
    state.layoutEpoch += 1;
  }

  function applyZoomToPages() {
    const viewport = $('pdf-viewport');
    const previousHeight = viewport.scrollHeight || 1;
    const ratio = viewport.scrollTop / previousHeight;
    state.fixture.pages.forEach(page => {
      const element = pageElement(page.pageIndex);
      if (!element) return;
      const size = pagePixelSize(page);
      element.style.width = `${size.width}px`;
      element.style.height = `${size.height}px`;
    });
    if (!state.selectedAnchorId) viewport.scrollTop = ratio * viewport.scrollHeight;
    state.layoutEpoch += 1;
    const viewportEl = $('pdf-viewport');
    if (viewportEl) viewportEl.dataset.layoutEpoch = String(state.layoutEpoch);
  }

  function markZoomChrome() {
    const label = $('zoom-label');
    if (label) label.textContent = `${Math.round(state.zoom * 100)}%`;
    const viewport = $('pdf-viewport');
    if (viewport) viewport.dataset.zoom = String(state.zoom);
    document.querySelectorAll('[data-zoom-preset]').forEach(button => {
      const selected = Math.abs(Number(button.dataset.zoomPreset) - state.zoom) < 0.001;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('selected', selected);
    });
  }

  function setZoom(next, options = {}) {
    if (!state.fixture) return state.zoom;
    state.zoom = clampZoom(next);
    applyZoomToPages();
    markZoomChrome();
    if (state.selectedAnchorId && options.keepAnchorInView !== false) {
      scrollToAnchor(state.selectedAnchorId, {behavior: 'auto'});
    }
    const payload = dispatchPdf('zoom', {zoom: state.zoom});
    if (typeof state.listeners.onLayout === 'function') state.listeners.onLayout(payload);
    return state.zoom;
  }

  function bumpZoom(delta) {
    const direction = Number(delta) >= 0 ? 1 : -1;
    if (direction > 0) {
      const next = ZOOM_STEPS.find(step => step > state.zoom + 0.001);
      return setZoom(next === undefined ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : next);
    }
    const previous = [...ZOOM_STEPS].reverse().find(step => step < state.zoom - 0.001);
    return setZoom(previous === undefined ? ZOOM_STEPS[0] : previous);
  }

  function getZoom() {
    return state.zoom;
  }

  function scrollViewportToElement(element, options = {}) {
    const viewport = $('pdf-viewport');
    if (!viewport || !element) return false;
    const viewportBox = viewport.getBoundingClientRect();
    const elementBox = element.getBoundingClientRect();
    const deltaY = (elementBox.top + elementBox.height / 2) - (viewportBox.top + viewportBox.height / 2);
    const deltaX = (elementBox.left + elementBox.width / 2) - (viewportBox.left + viewportBox.width / 2);
    viewport.scrollTo({
      top: viewport.scrollTop + deltaY,
      left: viewport.scrollLeft + deltaX,
      behavior: scrollBehavior(options.behavior)
    });
    return true;
  }

  function scrollToPage(pageIndex, options = {}) {
    const page = pageElement(pageIndex);
    if (!page) return {ok: false, reason: 'unknown_page'};
    scrollViewportToElement(page, options);
    publishVisiblePage();
    return {ok: true, pageIndex};
  }

  function scrollToAnchor(anchorOrId, options = {}) {
    const anchor = knownAnchor(anchorOrId);
    if (!anchor || !trustworthyRects(anchor.rects)) return {ok: false, reason: 'unknown_anchor'};
    const hotspot = hotspotElement(anchor.id) || pageElement(anchor.pageIndex);
    if (!hotspot) return {ok: false, reason: 'not_rendered'};
    scrollViewportToElement(hotspot, options);
    return {ok: true, anchorId: anchor.id, pageIndex: anchor.pageIndex};
  }

  function clearHighlightMarks() {
    document.querySelectorAll('[data-anchor-id], [data-anchor-hit]').forEach(element => {
      element.classList.remove('active');
      if (element.hasAttribute('data-active')) element.dataset.active = 'false';
      if (element.hasAttribute('aria-pressed')) element.setAttribute('aria-pressed', 'false');
    });
    document.querySelectorAll('[data-highlight-for]').forEach(element => element.remove());
  }

  function clearHighlight() {
    state.selectedAnchorId = null;
    clearHighlightMarks();
    const viewport = $('pdf-viewport');
    if (viewport) viewport.dataset.grounding = 'idle';
    const payload = dispatchPdf('highlight', {ok: true, reason: 'cleared', anchor: null});
    if (typeof state.listeners.onHighlight === 'function') state.listeners.onHighlight(payload);
    return {ok: true};
  }

  function paintHighlight(anchor) {
    clearHighlightMarks();
    const page = pageElement(anchor.pageIndex);
    const layer = page && page.querySelector('.pdf-annotation-layer');
    if (!layer) return false;
    anchor.rects.forEach(rect => {
      const shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      shape.setAttribute('class', 'pdf-highlight');
      shape.dataset.highlightFor = anchor.id;
      shape.dataset.pageIndex = String(anchor.pageIndex);
      const box = rectNumbers(rect);
      shape.setAttribute('x', String(box.x));
      shape.setAttribute('y', String(box.y));
      shape.setAttribute('width', String(box.width));
      shape.setAttribute('height', String(box.height));
      writeRectData(shape, box);
      layer.append(shape);
    });
    const escapedId = CSS.escape(anchor.id);
    document.querySelectorAll(`[data-anchor-id="${escapedId}"], [data-anchor-hit="${escapedId}"]`).forEach(element => {
      element.classList.add('active');
      if (element.hasAttribute('data-active')) element.dataset.active = 'true';
      if (element.hasAttribute('aria-pressed')) element.setAttribute('aria-pressed', 'true');
    });
    return true;
  }

  function highlightAnchor(anchorOrId, options = {}) {
    if (!state.fixture) return {ok: false, reason: 'not_mounted'};
    const anchor = knownAnchor(anchorOrId);
    const viewport = $('pdf-viewport');
    if (!anchor || !trustworthyRects(anchor.rects) || !pageElement(anchor.pageIndex) || !hotspotElement(anchor.id)) {
      if (viewport) viewport.dataset.grounding = state.selectedAnchorId ? 'anchored' : 'unlocated';
      const reason = anchor ? 'invalid_geometry' : 'unknown_anchor';
      const payload = dispatchPdf('highlight', {ok: false, reason, anchor: null});
      if (typeof state.listeners.onGroundingFailure === 'function') state.listeners.onGroundingFailure(payload);
      return {ok: false, reason};
    }
    state.selectedAnchorId = anchor.id;
    paintHighlight(anchor);
    if (viewport) viewport.dataset.grounding = 'anchored';
    if (options.scroll !== false) scrollToAnchor(anchor.id, options);
    const measured = measureAnchor(anchor.id);
    const payload = dispatchPdf('highlight', {
      ok: true,
      reason: 'anchored',
      anchor: {
        id: anchor.id,
        documentId: anchor.documentId,
        conceptId: anchor.conceptId,
        pageIndex: anchor.pageIndex,
        quote: anchor.quote,
        rects: anchor.rects,
        extractionMethod: anchor.extractionMethod,
        confidence: anchor.confidence
      },
      screenRects: measured ? measured.clientRects : []
    });
    if (typeof state.listeners.onHighlight === 'function') state.listeners.onHighlight(payload);
    return {
      ok: true,
      anchorId: anchor.id,
      pageIndex: anchor.pageIndex,
      rects: anchor.rects,
      screenRects: measured ? measured.clientRects : []
    };
  }

  function measureAnchor(anchorOrId) {
    const anchor = knownAnchor(anchorOrId);
    if (!anchor || !trustworthyRects(anchor.rects)) return null;
    const page = pageElement(anchor.pageIndex);
    if (!page) return null;
    const pageBox = contentBox(page);
    const hotspot = hotspotElement(anchor.id);
    const hotspotRect = hotspot ? hotspot.getBoundingClientRect() : null;
    const viewport = $('pdf-viewport').getBoundingClientRect();
    const visible = hotspotRect
      ? hotspotRect.width > 1
        && hotspotRect.height > 1
        && hotspotRect.bottom > viewport.top
        && hotspotRect.top < viewport.bottom
        && hotspotRect.right > viewport.left
        && hotspotRect.left < viewport.right
      : false;
    return {
      anchorId: anchor.id,
      pageIndex: anchor.pageIndex,
      quote: anchor.quote,
      normalizedRects: anchor.rects.map(rect => rectNumbers(rect)),
      clientRects: anchor.rects.map(rect => boxFrom(pageBox, rectNumbers(rect))),
      hotspotClientRect: hotspotRect ? {
        x: hotspotRect.x,
        y: hotspotRect.y,
        width: hotspotRect.width,
        height: hotspotRect.height,
        left: hotspotRect.left,
        top: hotspotRect.top,
        right: hotspotRect.right,
        bottom: hotspotRect.bottom
      } : null,
      pageClientRect: pageBox,
      visible,
      zoom: state.zoom
    };
  }

  function getSelectionContext() {
    const visible = getVisiblePage();
    const documentId = state.fixture ? state.fixture.document.id : null;
    const anchor = state.selectedAnchorId ? knownAnchor(state.selectedAnchorId) : null;
    if (!anchor) {
      return {
        documentId,
        anchorId: null,
        conceptId: null,
        pageIndex: visible.pageIndex,
        quote: null,
        rects: [],
        screenRects: [],
        extractionMethod: null,
        confidence: null,
        zoom: state.zoom,
        grounded: false
      };
    }
    const measured = measureAnchor(anchor.id);
    return {
      documentId: anchor.documentId,
      anchorId: anchor.id,
      conceptId: anchor.conceptId,
      pageIndex: anchor.pageIndex,
      quote: anchor.quote,
      rects: anchor.rects,
      screenRects: measured ? measured.clientRects : [],
      extractionMethod: anchor.extractionMethod,
      confidence: anchor.confidence,
      zoom: state.zoom,
      grounded: true
    };
  }

  function getVisiblePage() {
    const viewport = $('pdf-viewport');
    const pages = viewport ? [...viewport.querySelectorAll('.pdf-page-wrap')] : [];
    if (!pages.length) return {pageIndex: 0, pageNumber: 1, ratio: 0, visiblePx: 0};
    const viewportBox = viewport.getBoundingClientRect();
    let best = null;
    pages.forEach(element => {
      const rect = element.getBoundingClientRect();
      const visiblePx = Math.max(0, Math.min(rect.bottom, viewportBox.bottom) - Math.max(rect.top, viewportBox.top));
      const ratio = rect.height > 0 ? visiblePx / rect.height : 0;
      const pageIndex = Number(element.dataset.pageIndex);
      const candidate = {pageIndex, pageNumber: pageIndex + 1, ratio, visiblePx};
      if (!best || candidate.visiblePx > best.visiblePx) best = candidate;
    });
    return best;
  }

  function publishVisiblePage() {
    const page = getVisiblePage();
    const viewport = $('pdf-viewport');
    if (viewport) viewport.dataset.visiblePage = String(page.pageIndex);
    const label = $('page-label');
    const total = state.fixture ? state.fixture.pages.length : 0;
    if (label && total) label.textContent = `Page ${page.pageNumber} of ${total}`;
    document.querySelectorAll('.pdf-page-wrap').forEach(element => {
      const current = Number(element.dataset.pageIndex) === page.pageIndex;
      if (current) element.setAttribute('aria-current', 'true');
      else element.removeAttribute('aria-current');
    });
    if (typeof state.listeners.onVisiblePage === 'function') state.listeners.onVisiblePage(page);
    return page;
  }

  function placeMeasurementRects(pageIndex, rects) {
    const page = pageElement(pageIndex);
    const boxes = Array.isArray(rects) ? rects.map(rectNumbers) : [];
    if (!page || boxes.some(box => box === null)) return [];
    return boxes.map(rect => {
      const probe = document.createElement('div');
      probe.className = 'pdf-measurement';
      probe.dataset.measurementRect = 'true';
      probe.dataset.pageIndex = String(pageIndex);
      writeRectData(probe, rect);
      applyRect(probe, rect);
      page.append(probe);
      return probe;
    });
  }

  function clearMeasurementRects() {
    document.querySelectorAll('[data-measurement-rect]').forEach(element => element.remove());
  }

  function bindChrome() {
    if (state.chromeBound) return;
    state.chromeBound = true;
    const viewport = $('pdf-viewport');
    viewport.addEventListener('scroll', () => publishVisiblePage(), {passive: true});
    viewport.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'PageUp' && event.key !== 'PageDown') return;
      event.preventDefault();
      const current = getVisiblePage().pageIndex;
      const next = event.key === 'ArrowLeft' || event.key === 'PageUp' ? current - 1 : current + 1;
      scrollToPage(next, {behavior: scrollBehavior('smooth')});
    });
    const zoomOut = $('zoom-out');
    const zoomIn = $('zoom-in');
    if (zoomOut) zoomOut.addEventListener('click', () => bumpZoom(-1));
    if (zoomIn) zoomIn.addEventListener('click', () => bumpZoom(1));
    document.querySelectorAll('[data-zoom-preset]').forEach(button => {
      button.addEventListener('click', () => setZoom(Number(button.dataset.zoomPreset)));
    });
    const previous = $('page-prev');
    const next = $('page-next');
    if (previous) previous.addEventListener('click', () => scrollToPage(getVisiblePage().pageIndex - 1));
    if (next) next.addEventListener('click', () => scrollToPage(getVisiblePage().pageIndex + 1));
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        state.layoutEpoch += 1;
        if (viewport) viewport.dataset.layoutEpoch = String(state.layoutEpoch);
        dispatchPdf('layout', {});
      });
      observer.observe(viewport);
    }
  }

  function mount(fixture, listeners = {}) {
    if (!fixture || !Array.isArray(fixture.pages) || !fixture.pages.length || !Array.isArray(fixture.anchors)) {
      throw new Error('Mock document is incomplete');
    }
    state.fixture = fixture;
    state.listeners = listeners;
    state.selectedAnchorId = null;
    renderPages();
    bindChrome();
    markZoomChrome();
    const viewport = $('pdf-viewport');
    viewport.dataset.pdfApi = 'ready';
    viewport.dataset.grounding = 'idle';
    viewport.dataset.coordinateOrigin = 'top-left';
    publishVisiblePage();
    return api;
  }

  const api = {
    mount,
    scrollToAnchor,
    scrollToPage,
    highlightAnchor,
    clearHighlight,
    getSelectionContext,
    getVisiblePage,
    setZoom,
    getZoom,
    bumpZoom,
    measureAnchor,
    placeMeasurementRects,
    clearMeasurementRects
  };

  window.PdfViewerApi = api;
})();
