#!/usr/bin/env python3
"""Headless acceptance checks for SPEC §13 P0 tests and the §18.8 mock-mode gate.

Live unpacked-extension cursor following is reported SKIP. Everything else runs
against the static mock: offline contracts, then Chrome via Playwright.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'mock-app'
CONCEPTS = ('memory', 'addresses', 'pointers', 'ldr', 'str')
LABELS = {
    'memory': 'Memory',
    'addresses': 'Addresses',
    'pointers': 'Pointers',
    'ldr': 'LDR / Load',
    'str': 'STR / Store',
}
def relevant_ldr_caption(text):
    caption = text.strip()
    if 'R2' not in caption or 'does not call Grok' in caption or len(caption) < 40:
        raise AssertionError(f'explanation was {caption!r}')
    return caption
CHROME_CANDIDATES = (
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
)


class Skipped(Exception):
    pass


def chrome_path():
    for candidate in CHROME_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return None


def contains_in_order(actual, expected):
    index = 0
    for item in actual:
        if index < len(expected) and item == expected[index]:
            index += 1
    return index == len(expected)


def run_checked(command):
    completed = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, 'PYTHONWARNINGS': 'ignore::FutureWarning'},
    )
    if completed.returncode != 0:
        detail = (completed.stdout + completed.stderr).strip()
        raise AssertionError(detail or f'exit {completed.returncode}')
    return completed.stdout.strip()


def offline_checks():
    checks = []

    def add(name, fn):
        checks.append((name, fn))

    def syntax_and_model():
        run_checked(['node', '--check', str(APP / 'app.js')])
        run_checked(['node', '--check', str(APP / 'graph.js')])
        run_checked(['node', '--check', str(ROOT / 'extension' / 'content.js')])
        run_checked(['node', str(ROOT / 'tools' / 'test_graph_model.js')])

    def validate_mock():
        run_checked([sys.executable, str(ROOT / 'tools' / 'validate_mock.py')])

    def pdf_hash_and_pages():
        fixture = json.loads((APP / 'fixtures' / 'demo.json').read_text())
        pdf_path = APP / 'assets' / 'lc3-pointers-demo.pdf'
        digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
        if digest != fixture['document']['sha256']:
            raise AssertionError('PDF sha256 does not match demo.json')
        if fixture['document']['pageCount'] != 4 or len(fixture['pages']) != 4:
            raise AssertionError('fixture is not the 4-page demo')
        if len(fixture['graph']['nodes']) != 5 or len(fixture['graph']['relationships']) != 4:
            raise AssertionError('fixture graph is not 5 nodes and 4 related edges')
        import pymupdf
        document = pymupdf.open(pdf_path)
        try:
            if document.page_count != 4:
                raise AssertionError(f'PDF has {document.page_count} pages')
            for index, page in enumerate(document):
                rendered = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False)
                stored = pymupdf.Pixmap(str(APP / 'assets' / f'page-{index + 1}.png'))
                if (rendered.width, rendered.height, rendered.n) != (stored.width, stored.height, stored.n):
                    raise AssertionError(f'page {index + 1} image size does not match the PDF raster')
                if rendered.samples != stored.samples:
                    raise AssertionError(f'page {index + 1} PNG is not the PDF raster at 1.6x')
        finally:
            document.close()

    def hook_documented_and_wired():
        html = (APP / 'index.html').read_text()
        app_js = (APP / 'app.js').read_text()
        readme = (ROOT / 'README.md').read_text()
        if html.find('/graph.js') < 0 or html.find('/graph.js') > html.find('/app.js'):
            raise AssertionError('index.html must load /graph.js before /app.js')
        for name in ('focusConcept', 'getRelatedConceptIds', 'showRelatedConcepts', 'showPath', 'clearFocus'):
            if name not in app_js:
                raise AssertionError(f'GraphApi is missing {name}')
        if 'window.SmartPathGraph' not in app_js or 'smartpath:focus-concept' not in app_js:
            raise AssertionError('focus hook is not exposed')
        if 'window.SmartPathGraph' not in readme or 'smartpath:focus-concept' not in readme:
            raise AssertionError('README does not document the focus hook')
        if 'python3 -m http.server 5173 --directory mock-app' not in readme:
            raise AssertionError('README is missing the one-command startup')
        if 'Load unpacked' not in readme or 'Teach me LDR from scratch' not in readme:
            raise AssertionError('README is missing the demo handoff')

    def no_bundled_secrets():
        needles = ('GROK_API_KEY', 'api.x.ai', 'api.groq.com')
        roots = [APP, ROOT / 'extension']
        for folder in roots:
            for path in folder.rglob('*'):
                if path.suffix.lower() not in {'.js', '.html', '.json', '.css'}:
                    continue
                text = path.read_text(encoding='utf-8', errors='ignore')
                for needle in needles:
                    if needle in text:
                        raise AssertionError(f'{path.relative_to(ROOT)} contains {needle}')

    def cursor_follow_needs_chrome_extension():
        content = (ROOT / 'extension' / 'content.js').read_text()
        compact = content.replace(' ', '')
        if 'pointer-events:none' not in compact or "addEventListener('mousemove'" not in content:
            raise AssertionError('extension cursor overlay is missing a non-blocking follower')
        raise Skipped(
            'Needs an unpacked MV3 Chrome profile. Static check: overlay is pointer-events:none and follows mousemove.'
        )

    add('offline syntax + related-path model', syntax_and_model)
    add('18.8.4 / 13.2 validate_mock PDF anchors, graph, manifest', validate_mock)
    add('13.2 / 18.8.4 PDF hash and page images match the generated PDF', pdf_hash_and_pages)
    add('18.8.10 README demo steps and focus hook', hook_documented_and_wired)
    add('privacy: mock and extension bundle no API key', no_bundled_secrets)
    add('13.1 cursor follows the physical pointer', cursor_follow_needs_chrome_extension)
    return checks


def assert_focus(page, concept_id):
    for concept in CONCEPTS:
        node = page.locator(f'[data-concept-id="{concept}"]')
        expected = 'true' if concept == concept_id else 'false'
        active = node.get_attribute('data-active')
        pressed = node.get_attribute('aria-pressed')
        if active != expected or pressed != expected:
            raise AssertionError(f'{concept}: data-active={active} aria-pressed={pressed}, want {expected}')
    if page.locator('[data-concept-id]').count() != 5:
        raise AssertionError('expected exactly one button per concept id')
    title = page.locator('#focused-concept').inner_text()
    if LABELS[concept_id] not in title:
        raise AssertionError(f'footer {title!r} does not show {LABELS[concept_id]}')


def install_trace(page):
    page.evaluate(
        '''() => {
          window.__trace = {anchors: [], concepts: [], steps: [], types: []};
          window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || data.source !== 'smartpath-mock-app') return;
            window.__trace.types.push(data.type);
            if (data.type === 'source_selected' && data.anchorId) window.__trace.anchors.push(data.anchorId);
            if (data.type === 'concept_focused' && data.conceptId) window.__trace.concepts.push(data.conceptId);
            if (data.type === 'step_verified' && data.stepId) window.__trace.steps.push(data.stepId);
          });
        }'''
    )


def open_page(browser, base):
    errors = []
    external = []
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('request', lambda request: external.append(request.url) if not request.url.startswith(base) and not request.url.startswith(('data:', 'blob:')) else None)
    page.goto(base + '/', wait_until='domcontentloaded')
    page.wait_for_selector('[data-concept-id="ldr"]')
    page.wait_for_function('() => document.querySelectorAll(".pdf-page-wrap").length === 4')
    page.wait_for_function('() => window.SmartPathGraph && window.SmartPathGraph.getRelatedConceptIds("pointers").join() === "addresses,ldr,str"')
    return page, errors, external


def assert_page_clean(errors, external):
    if errors:
        raise AssertionError('page errors: ' + ' | '.join(errors))
    if external:
        raise AssertionError('unexpected network: ' + ', '.join(external[:8]))


def browser_checks(base):
    from playwright.sync_api import sync_playwright

    scenarios = []

    def add(name, fn):
        scenarios.append((name, fn))

    def workspace_shell(page, errors, external):
        page.wait_for_function(
            "() => document.getElementById('extension-status').textContent.includes('app-only')",
            timeout=4000,
        )
        status = page.locator('#extension-status').inner_text()
        if 'app-only' not in status:
            raise AssertionError(status)
        if 'Grok' in status:
            raise AssertionError('app-only status claims Grok')
        if 'FIXTURE' not in page.locator('.fixture-tag').inner_text():
            raise AssertionError('fixture mode is not labeled')
        if page.locator('.pdf-page-wrap').count() != 4 or page.locator('[data-concept-id]').count() != 5:
            raise AssertionError('expected 4 PDF pages and 5 graph nodes')
        if page.locator('#graph-links line').count() != 4:
            raise AssertionError('expected 4 rendered relationships')
        assert_page_clean(errors, external)

    def click_reset_reselect(page, errors, external):
        for concept in CONCEPTS:
            page.locator(f'[data-concept-id="{concept}"]').click()
            assert_focus(page, concept)
            anchor_id = page.evaluate(
                '(id) => document.querySelector(`[data-concept-id="${id}"]`) && window.SmartPathGraph.getFocusedConceptId()',
                concept,
            )
            if anchor_id != concept:
                raise AssertionError(f'click did not focus {concept}')
        page.locator('#reset-graph').click()
        if page.evaluate('() => window.SmartPathGraph.getFocusedConceptId()') is not None:
            raise AssertionError('reset left a focused concept')
        if page.locator('[data-concept-id][data-active="true"]').count() != 0:
            raise AssertionError('reset left an active node')
        if 'learning map' not in page.locator('#focused-concept').inner_text().lower():
            raise AssertionError('reset did not restore the graph summary title')
        page.locator('[data-concept-id="pointers"]').click()
        assert_focus(page, 'pointers')
        page.locator('[data-concept-id="memory"]').click()
        assert_focus(page, 'memory')
        if page.locator('[data-concept-id="pointers"]').get_attribute('data-active') != 'false':
            raise AssertionError('previous concept stayed active after re-selection')
        page.locator('[data-concept-id="str"]').focus()
        page.keyboard.press('Enter')
        assert_focus(page, 'str')
        assert_page_clean(errors, external)

    def explain_and_path(page, errors, external):
        page.locator('[data-anchor-id="ldr_instruction"]').click()
        assert_focus(page, 'ldr')
        if page.locator('[data-anchor-id="ldr_instruction"]').get_attribute('data-active') != 'true':
            raise AssertionError('LDR passage is not the active hotspot')
        if 'page 3' not in page.locator('#selected-page-caption').inner_text():
            raise AssertionError('page label missing for LDR')
        page.evaluate(
            '''() => {
              window.__spoken = [];
              if (window.speechSynthesis) {
                const original = window.speechSynthesis.speak.bind(window.speechSynthesis);
                window.speechSynthesis.speak = (utterance) => {
                  window.__spoken.push(String(utterance && utterance.text || ''));
                  return original(utterance);
                };
              }
            }'''
        )
        if page.locator('#voice-toggle').get_attribute('aria-pressed') != 'true':
            page.locator('#voice-toggle').click()
        page.locator('#prompt').fill('explain this')
        page.locator('#send-prompt').click()
        assert_focus(page, 'ldr')
        caption = relevant_ldr_caption(page.locator('#caption-text').inner_text())
        if 'page 3' not in page.locator('#selected-page-caption').inner_text():
            raise AssertionError('explain this dropped the page label')
        spoken = page.evaluate('() => window.__spoken || []')
        if spoken != [caption]:
            raise AssertionError(f'spoken output was {spoken!r}')
        page.locator('#prompt').fill('explain simpler')
        page.locator('#send-prompt').click()
        simpler = relevant_ldr_caption(page.locator('#caption-text').inner_text())
        page.locator('#prompt').fill('explain simpler')
        page.locator('#send-prompt').click()
        if page.locator('#caption-text').inner_text().strip() != simpler:
            raise AssertionError('explain simpler was not deterministic')
        assert_focus(page, 'ldr')
        rejected = page.evaluate(
            '''() => {
              const api = window.SmartPathGraph;
              api.focusConcept('str');
              return {unknown: api.focusConcept('not-a-concept'), kept: api.getFocusedConceptId(), bad: api.showPath(['memory', 'ldr'])};
            }'''
        )
        if rejected['unknown'] is not False or rejected['bad'] is not None or rejected['kept'] != 'str':
            raise AssertionError(f'invalid focus changed state: {rejected}')
        assert_focus(page, 'str')
        guided = page.evaluate('() => window.SmartPathGraph.showPath(["memory", "addresses", "pointers"])')
        if guided != ['memory', 'addresses', 'pointers']:
            raise AssertionError(f'3-node path was {guided}')
        assert_focus(page, 'pointers')
        if page.locator('[data-concept-id="addresses"]').get_attribute('data-on-path') != 'true':
            raise AssertionError('addresses was not marked on the path')
        if page.locator('[data-concept-id="addresses"]').get_attribute('data-active') != 'false':
            raise AssertionError('a non-destination path node was focused')
        if page.locator('[data-concept-id]').count() != 5:
            raise AssertionError('showPath removed a node')
        route = page.evaluate(
            '''() => {
              const path = window.SmartPathGraph.showPath({from: 'memory', to: 'ldr'});
              const edge = document.querySelector('#graph-links line[data-source="memory"][data-target="addresses"]');
              const side = document.querySelector('#graph-links line[data-source="pointers"][data-target="str"]');
              const shortcut = document.querySelector('#graph-links line[data-source="memory"][data-target="ldr"]');
              return {
                path,
                memoryEdge: edge && edge.dataset.onPath,
                sideEdge: side && side.dataset.onPath,
                shortcut: Boolean(shortcut),
                summary: document.getElementById('graph-summary').textContent
              };
            }'''
        )
        if route['path'] != ['memory', 'addresses', 'pointers', 'ldr']:
            raise AssertionError(f'shortest path was {route["path"]}')
        if route['memoryEdge'] != 'true' or route['sideEdge'] != 'false' or route['shortcut']:
            raise AssertionError(f'path edges were wrong: {route}')
        if 'not prerequisites' not in route['summary']:
            raise AssertionError(f'summary invented a prerequisite: {route["summary"]}')
        assert_focus(page, 'ldr')
        related = page.evaluate('() => window.SmartPathGraph.showRelatedConcepts("pointers")')
        if related != ['addresses', 'ldr', 'str']:
            raise AssertionError(f'related ids were {related}')
        if page.locator('[data-concept-id="ldr"]').get_attribute('data-related') != 'true':
            raise AssertionError('LDR was not marked related to Pointers')
        if page.locator('[data-concept-id="memory"]').get_attribute('data-related') != 'false':
            raise AssertionError('unrelated Memory was marked related')
        page.locator('#prompt').fill('show related concepts')
        page.locator('#send-prompt').click()
        # Prompt runs against the focused node. showRelatedConcepts above left Pointers focused.
        related_caption = page.locator('#caption-text').inner_text()
        if 'not prerequisites' not in related_caption or 'LDR' not in related_caption:
            raise AssertionError(f'related caption was {related_caption!r}')
        page.evaluate(
            '''() => document.dispatchEvent(new CustomEvent('smartpath:focus-concept', {detail: {conceptId: 'addresses'}}))'''
        )
        assert_focus(page, 'addresses')
        page.evaluate(
            '''() => document.dispatchEvent(new CustomEvent('smartpath:focus-concept', {detail: {conceptId: 'missing-concept'}}))'''
        )
        assert_focus(page, 'addresses')
        page.evaluate(
            '''() => document.dispatchEvent(new CustomEvent('smartpath:show-path', {detail: {conceptIds: ['pointers', 'str']}}))'''
        )
        assert_focus(page, 'str')
        if page.locator('[data-concept-id="pointers"]').get_attribute('data-on-path') != 'true':
            raise AssertionError('custom show-path did not mark Pointers')
        page.evaluate('''() => window.postMessage({source:'smartpath-live-extension', type:'focus_concept', conceptId:'memory'}, location.origin)''')
        page.wait_for_function('() => window.SmartPathGraph.getFocusedConceptId() === "memory"')
        assert_focus(page, 'memory')
        page.evaluate('''() => document.dispatchEvent(new CustomEvent('smartpath:clear-focus'))''')
        if page.evaluate('() => window.SmartPathGraph.getFocusedConceptId()') is not None:
            raise AssertionError('clear-focus event left a selection')
        if page.locator('[data-on-path="true"]').count() != 0:
            raise AssertionError('clear-focus left a path highlight')
        artifact = Path('/opt/cursor/artifacts')
        try:
            artifact.mkdir(parents=True, exist_ok=True)
            page.evaluate('() => window.SmartPathGraph.showPath({from: "memory", to: "ldr"})')
            page.locator('#graph-canvas').scroll_into_view_if_needed()
            page.screenshot(path=str(artifact / 'graph-focus-path.png'))
        except OSError:
            pass
        assert_page_clean(errors, external)

    def unknown_topic(page, errors, external):
        page.locator('#prompt').fill('What is quantum entanglement?')
        page.locator('#send-prompt').click()
        caption = page.locator('#caption-text').inner_text()
        if 'does not call Grok' not in caption:
            raise AssertionError(f'missing-topic caption was {caption!r}')
        if page.locator('[data-anchor-id][data-active="true"]').count() != 0:
            raise AssertionError('unknown topic highlighted a passage')
        if page.locator('[data-concept-id][data-active="true"]').count() != 0:
            raise AssertionError('unknown topic focused a node')
        if page.locator('[data-anchor-id]').count() != 10:
            raise AssertionError('unknown topic changed the anchor set')
        assert_page_clean(errors, external)

    def text_without_microphone(page, errors, external):
        page.locator('#mic-button').click()
        page.locator('#prompt').fill('explain this')
        page.locator('#send-prompt').click()
        relevant_ldr_caption(page.locator('#caption-text').inner_text())
        assert_focus(page, 'ldr')
        if not page.locator('#prompt').is_enabled():
            raise AssertionError('text prompt was disabled after microphone failure')
        assert_page_clean(errors, external)

    def run_lesson(page, prompt):
        install_trace(page)
        page.locator('#prompt').fill(prompt)
        page.locator('#send-prompt').click()
        page.locator('#quiz-backdrop').wait_for(state='visible', timeout=25000)
        trace = page.evaluate('() => window.__trace')
        if not contains_in_order(trace['anchors'], ['memory_example', 'pointer_register', 'ldr_instruction']):
            raise AssertionError(f'anchor order was {trace["anchors"]}')
        if not contains_in_order(trace['concepts'], ['pointers', 'ldr']):
            raise AssertionError(f'concept order was {trace["concepts"]}')
        known = set(CONCEPTS)
        if any(concept not in known for concept in trace['concepts']):
            raise AssertionError(f'lesson focused an unknown concept: {trace["concepts"]}')
        if trace['steps'] != ['s1', 's2', 's3', 's4', 's5', 's6']:
            raise AssertionError(f'steps were {trace["steps"]}')
        if page.locator('[data-anchor-id="ldr_instruction"]').get_attribute('data-active') != 'true':
            raise AssertionError('lesson did not leave the LDR passage active')
        assert_focus(page, 'ldr')
        if page.locator('#quiz-card').get_attribute('data-quiz-concept') != 'ldr':
            raise AssertionError('quiz is not bound to the ldr concept')
        return trace

    def teach_pointers(page, errors, external):
        run_lesson(page, 'teach me pointers')
        assert_page_clean(errors, external)

    def teach_ldr_and_quiz(page, errors, external):
        run_lesson(page, 'Teach me LDR from scratch')
        before = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        progress_before = page.locator('[data-progress-for="ldr"]').inner_text()
        page.locator('.quiz-choice', has_text='B. 7').click()
        feedback = page.locator('#quiz-feedback').inner_text()
        if 'Correct' not in feedback:
            raise AssertionError(feedback)
        after = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        if abs(after - (before + 0.1)) > 0.001:
            raise AssertionError(f'confidence {before} -> {after}')
        progress_after = page.locator('[data-progress-for="ldr"]').inner_text()
        if '41%' not in progress_after or progress_after == progress_before:
            raise AssertionError(f'progress did not move to 41%: {progress_after!r}')
        assert_page_clean(errors, external)

    def wrong_quiz_answer(page, errors, external):
        before = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        page.locator('#top-quiz').click()
        page.locator('.quiz-choice', has_text='A. x4000').click()
        feedback = page.locator('#quiz-feedback').inner_text()
        if 'Not quite' not in feedback:
            raise AssertionError(feedback)
        after = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        if abs(after - before) > 0.001:
            raise AssertionError(f'wrong answer changed confidence {before} -> {after}')
        assert_page_clean(errors, external)

    def pause_holds_scroll(page, errors, external):
        page.locator('#start-lesson').click()
        page.locator('#lesson-strip').wait_for(state='visible')
        page.locator('#pause-btn').click()
        page.wait_for_function("() => document.getElementById('caption-title').textContent.toLowerCase().includes('paused')")
        page.wait_for_timeout(800)
        progress = page.locator('#lesson-progress').inner_text()
        confidence = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        page.evaluate(
            '''() => {
              const el = document.getElementById('pdf-viewport');
              el.style.scrollBehavior = 'auto';
              el.scrollTop = 320;
            }'''
        )
        midpoint = page.evaluate('() => document.getElementById("pdf-viewport").scrollTop')
        if midpoint < 100:
            raise AssertionError(f'viewport did not scroll (scrollTop={midpoint})')
        page.wait_for_timeout(1600)
        end = page.evaluate('() => document.getElementById("pdf-viewport").scrollTop')
        if abs(end - midpoint) > 8:
            raise AssertionError(f'paused lesson moved the viewport {midpoint} -> {end}')
        if page.locator('#lesson-progress').inner_text() != progress:
            raise AssertionError('paused lesson advanced a step')
        if 'paused' not in page.locator('#caption-title').inner_text().lower():
            raise AssertionError('lesson left the paused state on its own')
        page.locator('#resume-btn').click()
        page.locator('#quiz-backdrop').wait_for(state='visible', timeout=25000)
        later = float(page.locator('[data-concept-id="ldr"]').get_attribute('data-confidence'))
        if abs(later - confidence) > 0.001:
            raise AssertionError(f'resume wrote confidence {confidence} -> {later}')
        assert_page_clean(errors, external)

    def stop_cancels(page, errors, external):
        page.locator('#voice-toggle').click()
        install_trace(page)
        page.locator('#start-lesson').click()
        page.locator('#lesson-strip').wait_for(state='visible')
        page.locator('#stop-btn').click()
        page.wait_for_function("() => document.getElementById('caption-title').textContent.toLowerCase().includes('stopped')")
        if page.locator('#lesson-strip').is_visible():
            raise AssertionError('stop left the lesson strip up')
        page.wait_for_timeout(9000)
        if page.locator('#quiz-backdrop').is_visible():
            raise AssertionError('stop did not prevent the quiz')
        trace = page.evaluate('() => window.__trace.types')
        if 'lesson_stopped' not in trace or 'quiz_opened' in trace or 'lesson_completed' in trace:
            raise AssertionError(f'stop trace was {trace}')
        speaking = page.evaluate('() => "speechSynthesis" in window && window.speechSynthesis.speaking')
        if speaking:
            raise AssertionError('speech kept running after stop')
        assert_page_clean(errors, external)

    add('18.8.2 / 18.8.3 / 18.8.9 app-only shell, 4 pages, 5 nodes, no Grok', workspace_shell)
    add('13.9 / F06 click, reset, re-select, keyboard focus', click_reset_reselect)
    add('F06 / 13.3 / 13.5 explain focuses the node; paths use related edges', explain_and_path)
    add('13.8 unknown topic does not invent an anchor or node', unknown_topic)
    add('13.10 text input works when microphone is unavailable', text_without_microphone)
    add('13.4 teach me pointers walks real anchors and concept ids', teach_pointers)
    add('18.8.5 / 18.8.6 / 18.8.7 Teach LDR, verified focus, quiz B. 7', teach_ldr_and_quiz)
    add('quiz wrong answer does not change confidence', wrong_quiz_answer)
    add('13.6 / 18.8.8 pause holds scroll; resume does not write progress', pause_holds_scroll)
    add('13.7 / 18.8.8 stop cancels speech and does not advance', stop_cancels)
    def live_extension(page, errors, external):
        raise Skipped('Headless run has no unpacked extension. App-only mode is checked separately.')

    add('18.8.2 live extension detection', live_extension)

    chrome = chrome_path()
    if not chrome:
        raise RuntimeError('Chrome or Chromium is required')
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=chrome,
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        )
        try:
            for name, fn in scenarios:
                page = None
                try:
                    page, errors, external = open_page(browser, base)
                    fn(page, errors, external)
                except Skipped as skipped:
                    results.append(('SKIP', name, str(skipped)))
                except Exception as exc:
                    if page is not None:
                        try:
                            Path('/tmp').mkdir(exist_ok=True)
                            page.screenshot(path=f'/tmp/acceptance-{len(results)}.png')
                        except Exception:
                            pass
                    results.append(('FAIL', name, f'{type(exc).__name__}: {exc}'))
                else:
                    results.append(('PASS', name, ''))
                finally:
                    if page is not None:
                        page.close()
        finally:
            browser.close()
    return results


def start_server():
    preferred = int(os.environ.get('ACCEPTANCE_PORT', '8765'))
    for port in range(preferred, preferred + 10):
        process = subprocess.Popen(
            [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', str(APP)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        ready = False
        for _ in range(30):
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/fixtures/demo.json', timeout=1) as response:
                    if response.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.1)
        if ready:
            return process, f'http://127.0.0.1:{port}'
        process.terminate()
    raise RuntimeError('could not start the mock server')


def execute(named_checks):
    results = []
    for name, fn in named_checks:
        try:
            fn()
        except Skipped as skipped:
            results.append(('SKIP', name, str(skipped)))
        except Exception as exc:
            results.append(('FAIL', name, f'{type(exc).__name__}: {exc}'))
        else:
            results.append(('PASS', name, ''))
    return results


def main():
    results = execute(offline_checks())
    server = None
    try:
        server, base = start_server()
        results.append(('PASS', '18.8.1 static server serves the fixture without secrets', base))
        try:
            results.extend(browser_checks(base))
        except Exception as exc:
            results.append(('FAIL', 'browser harness', f'{type(exc).__name__}: {exc}'))
    except Exception as exc:
        results.append(('FAIL', '18.8.1 static server', f'{type(exc).__name__}: {exc}'))
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.kill()
    failed = 0
    skipped = 0
    passed = 0
    for status, name, detail in results:
        if status == 'PASS':
            passed += 1
        elif status == 'SKIP':
            skipped += 1
        else:
            failed += 1
        line = f'{status:4}  {name}'
        if detail:
            line += f' — {detail}'
        print(line)
    print(f'{passed} passed, {skipped} skipped, {failed} failed')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
