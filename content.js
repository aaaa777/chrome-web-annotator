/* === Web Annotator Content Script === */

(function () {
  'use strict';

  const STORAGE_KEY = 'web_annotator_data';
  let annotations = [];
  let tooltip = null;

  // --- Storage ---

  function getPageKey() {
    return location.origin + location.pathname;
  }

  async function loadAnnotations() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          const all = result[STORAGE_KEY] || {};
          annotations = all[getPageKey()] || [];
          resolve(annotations);
        });
      } catch { resolve([]); }
    });
  }

  async function saveAnnotations() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          const all = result[STORAGE_KEY] || {};
          all[getPageKey()] = annotations;
          chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
        });
      } catch { resolve(); }
    });
  }

  // --- TextQuoteSelector ---

  function createSelector(range) {
    const exact = range.toString();
    const startNode = range.startContainer;
    const endNode = range.endContainer;
    const prefix = (startNode.textContent || '').substring(
      Math.max(0, range.startOffset - 50),
      range.startOffset
    );
    const suffix = (endNode.textContent || '').substring(
      range.endOffset,
      range.endOffset + 50
    );
    return { type: 'TextQuoteSelector', exact, prefix, suffix };
  }

  function findTextInNode(node, query) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let current;
    while ((current = walker.nextNode())) {
      const idx = current.textContent.indexOf(query);
      if (idx !== -1) {
        return { node: current, offset: idx };
      }
    }
    return null;
  }

  // --- Highlight rendering ---

  function highlightAnnotation(anno) {
    const found = findTextInNode(document.body, anno.selector.exact);
    if (!found) return;

    const range = document.createRange();
    range.setStart(found.node, found.offset);
    range.setEnd(found.node, Math.min(found.offset + anno.selector.exact.length, found.node.textContent.length));

    const mark = document.createElement('mark');
    mark.classList.add('wa-highlight');
    mark.dataset.annotationId = anno.id;
    mark.title = anno.comment || '';

    mark.addEventListener('click', (e) => {
      e.stopPropagation();
      showAnnotationDetail(anno, mark);
    });

    try {
      range.surroundContents(mark);
    } catch {
      // surroundContents fails if range crosses element boundaries
    }
  }

  function renderAllHighlights() {
    document.querySelectorAll('.wa-highlight').forEach((el) => el.outerHTML = el.innerHTML);
    annotations.forEach(highlightAnnotation);
  }

  // --- Annotation detail popup ---

  function showAnnotationDetail(anno, anchorEl) {
    removeTooltip();

    const div = document.createElement('div');
    div.classList.add('wa-tooltip');

    const rect = anchorEl.getBoundingClientRect();
    div.style.top = (window.scrollY + rect.bottom + 8) + 'px';
    div.style.left = (window.scrollX + rect.left) + 'px';

    div.innerHTML = `
      <div class="wa-tooltip-body">
        <div class="wa-tooltip-comment">${escapeHtml(anno.comment || '(コメントなし)')}</div>
        <div class="wa-tooltip-actions">
          <button class="wa-btn wa-btn-delete" data-id="${anno.id}">削除</button>
          <button class="wa-btn wa-btn-close">閉じる</button>
        </div>
      </div>
    `;

    div.querySelector('.wa-btn-delete').addEventListener('click', async () => {
      annotations = annotations.filter((a) => a.id !== anno.id);
      await saveAnnotations();
      renderAllHighlights();
      removeTooltip();
    });

    div.querySelector('.wa-btn-close').addEventListener('click', removeTooltip);

    document.body.appendChild(div);
    tooltip = div;
  }

  // --- Selection tooltip (add comment) ---

  function showSelectionTooltip(selection) {
    removeTooltip();

    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const div = document.createElement('div');
    div.classList.add('wa-tooltip', 'wa-tooltip-add');

    div.style.top = (window.scrollY + rect.bottom + 8) + 'px';
    div.style.left = (window.scrollX + rect.left) + 'px';

    div.innerHTML = `
      <div class="wa-tooltip-body">
        <textarea class="wa-input" placeholder="コメントを入力..." rows="3"></textarea>
        <div class="wa-tooltip-actions">
          <button class="wa-btn wa-btn-save">保存</button>
          <button class="wa-btn wa-btn-close">閉じる</button>
        </div>
      </div>
    `;

    const textarea = div.querySelector('.wa-input');

    div.querySelector('.wa-btn-save').addEventListener('click', async () => {
      const comment = textarea.value.trim();
      const selector = createSelector(range);
      const anno = {
        id: 'anno-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        selector,
        comment,
        url: location.href,
        title: document.title,
        created: new Date().toISOString()
      };
      annotations.push(anno);
      await saveAnnotations();
      renderAllHighlights();
      removeTooltip();
    });

    div.querySelector('.wa-btn-close').addEventListener('click', removeTooltip);

    // Prevent mousedown inside tooltip from clearing the text selection
    div.addEventListener('mousedown', (e) => {
      if (!e.target.matches('.wa-input')) {
        e.preventDefault();
      }
    });

    document.body.appendChild(div);
    tooltip = div;
  }

  // --- Util ---

  function removeTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Event listeners ---

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('.wa-tooltip')) return;

    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) {
      setTimeout(() => showSelectionTooltip(selection), 100);
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.wa-tooltip') && !e.target.closest('.wa-highlight')) {
      removeTooltip();
    }
  });

  // --- Message handler (from popup) ---

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'GET_ANNOTATIONS') {
      loadAnnotations().then(() => {
        sendResponse({ annotations, url: location.href, title: document.title });
      });
      return true;
    }
    if (request.type === 'DELETE_ANNOTATION') {
      annotations = annotations.filter((a) => a.id !== request.id);
      saveAnnotations().then(() => {
        renderAllHighlights();
        sendResponse({ success: true });
      });
      return true;
    }
    if (request.type === 'RELOAD') {
      loadAnnotations().then(() => {
        renderAllHighlights();
        sendResponse({ success: true });
      });
      return true;
    }
  });

  // --- Init ---

  loadAnnotations().then(renderAllHighlights);
})();
