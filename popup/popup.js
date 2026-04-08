/* === Popup Script === */

(function () {
  'use strict';

  const STORAGE_KEY = 'web_annotator_data';
  const listEl = document.getElementById('annotations-list');
  const pageInfoEl = document.getElementById('page-info');
  const copyBtn = document.getElementById('copy-btn');
  const clearBtn = document.getElementById('clear-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');

  let currentAnnotations = [];
  let currentUrl = '';
  let currentTitle = '';
  let activeTab = 'current'; // 'current' or 'all'

  // --- Tab switching ---

  function updateButtonLabels() {
    if (activeTab === 'current') {
      copyBtn.textContent = 'このページをコピー';
      clearBtn.textContent = 'このページを削除';
    } else {
      copyBtn.textContent = 'すべてコピー';
      clearBtn.textContent = 'すべて削除';
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      if (activeTab === 'current') {
        pageInfoEl.textContent = currentTitle;
        pageInfoEl.style.display = '';
        renderAnnotations();
      } else {
        pageInfoEl.style.display = 'none';
        renderAllPages();
      }
      updateButtonLabels();
      updateButtonState();
    });
  });

  // --- Load from active tab ---

  async function loadFromTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showEmpty('タブが見つかりません');
      return;
    }

    currentUrl = tab.url || '';
    currentTitle = tab.title || '';
    pageInfoEl.textContent = currentTitle;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ANNOTATIONS' });
      currentAnnotations = response.annotations || [];
      currentUrl = response.url || currentUrl;
      currentTitle = response.title || currentTitle;
      pageInfoEl.textContent = currentTitle;
      renderAnnotations();
    } catch {
      showEmpty('このページではアノテーションを使用できません');
    }
  }

  // --- Render current page ---

  function renderAnnotations() {
    if (currentAnnotations.length === 0) {
      showEmpty('このページにアノテーションはありません');
      copyBtn.disabled = true;
      return;
    }

    copyBtn.disabled = false;
    listEl.innerHTML = '';

    currentAnnotations.forEach((anno) => {
      listEl.appendChild(createAnnotationItem(anno, false));
    });
    updateButtonState();
  }

  // --- Render all pages ---

  function renderAllPages() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const all = result[STORAGE_KEY] || {};
      const pages = Object.entries(all).filter(([, annos]) => annos.length > 0);

      if (pages.length === 0) {
        showEmpty('アノテーションはありません');
        return;
      }

      listEl.innerHTML = '';

      pages.forEach(([pageUrl, annos]) => {
        const pageTitle = annos[0]?.title || pageUrl;

        const header = document.createElement('div');
        header.classList.add('page-group-header');
        const displayUrl = pageUrl.length > 60 ? pageUrl.substring(0, 60) + '...' : pageUrl;
        header.innerHTML = `<a href="${escapeHtml(pageUrl)}" target="_blank" class="page-group-link">${escapeHtml(pageTitle)}</a>
          <span class="page-group-count">${annos.length}</span>`;
        listEl.appendChild(header);

        annos.forEach((anno) => {
          listEl.appendChild(createAnnotationItem(anno, true, pageUrl));
        });
      });
    });
  }

  // --- Shared annotation item builder ---

  function createAnnotationItem(anno, isAllView, pageUrl) {
    const item = document.createElement('div');
    item.classList.add('annotation-item');

    const quote = anno.selector?.exact || '';
    const displayQuote = quote.length > 100 ? quote.substring(0, 100) + '...' : quote;

    item.innerHTML = `
      <div class="annotation-quote">${escapeHtml(displayQuote)}</div>
      ${anno.comment ? `<div class="annotation-comment">${escapeHtml(anno.comment)}</div>` : ''}
      <div class="annotation-meta">${formatDate(anno.created)}</div>
      <div class="annotation-actions">
        <button class="delete-btn" data-id="${anno.id}">削除</button>
      </div>
    `;

    item.querySelector('.delete-btn').addEventListener('click', async () => {
      if (isAllView) {
        await deleteAnnotationFromStorage(anno.id, pageUrl);
        renderAllPages();
      } else {
        await deleteAnnotation(anno.id);
      }
    });

    return item;
  }

  function showEmpty(message) {
    listEl.innerHTML = `<p class="empty-message">${escapeHtml(message)}</p>`;
  }

  // --- Actions ---

  async function deleteAnnotation(id) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.tabs.sendMessage(tab.id, { type: 'DELETE_ANNOTATION', id });
    currentAnnotations = currentAnnotations.filter((a) => a.id !== id);
    renderAnnotations();
  }

  async function deleteAnnotationFromStorage(id, pageUrl) {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const all = result[STORAGE_KEY] || {};
        if (all[pageUrl]) {
          all[pageUrl] = all[pageUrl].filter((a) => a.id !== id);
          if (all[pageUrl].length === 0) delete all[pageUrl];
        }
        chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
      });
    });
  }

  function formatForChat(annotations, url, title) {
    if (annotations.length === 0) return '';

    let text = `## アノテーション: [${title}](${url})\n\n`;
    annotations.forEach((anno) => {
      text += `> ${anno.selector?.exact || ''}\n`;
      if (anno.comment) {
        text += `\nコメント: ${anno.comment}\n`;
      }
      text += '\n---\n\n';
    });
    return text.trim();
  }

  async function formatAllPages() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const all = result[STORAGE_KEY] || {};
        let text = '';
        for (const [pageUrl, annos] of Object.entries(all)) {
          if (annos.length === 0) continue;
          const pageTitle = annos[0]?.title || pageUrl;
          text += formatForChat(annos, pageUrl, pageTitle) + '\n\n';
        }
        resolve(text.trim());
      });
    });
  }

  async function copyToClipboard(text) {
    await navigator.clipboard.writeText(text);
    showCopiedFeedback();
  }

  function showCopiedFeedback() {
    const existing = document.querySelector('.copied-feedback');
    if (existing) existing.remove();

    const feedback = document.createElement('div');
    feedback.classList.add('copied-feedback');
    feedback.textContent = 'クリップボードにコピーしました';
    document.querySelector('.popup-container').appendChild(feedback);
    setTimeout(() => feedback.remove(), 2000);
  }

  // --- Util ---

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // --- Check if any annotations exist ---

  function updateButtonState() {
    if (activeTab === 'current') {
      copyBtn.disabled = currentAnnotations.length === 0;
      clearBtn.disabled = currentAnnotations.length === 0;
    } else {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const all = result[STORAGE_KEY] || {};
        const totalCount = Object.values(all).reduce((sum, arr) => sum + arr.length, 0);
        copyBtn.disabled = totalCount === 0;
        clearBtn.disabled = totalCount === 0;
      });
    }
  }

  // --- Event listeners ---

  copyBtn.addEventListener('click', async () => {
    if (activeTab === 'current') {
      const text = formatForChat(currentAnnotations, currentUrl, currentTitle);
      if (text) copyToClipboard(text);
    } else {
      const text = await formatAllPages();
      if (text) copyToClipboard(text);
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (activeTab === 'current') {
      if (!confirm('このページのアノテーションを削除しますか？')) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      // Remove current page from storage
      await new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
          const all = result[STORAGE_KEY] || {};
          const pageKey = new URL(currentUrl).origin + new URL(currentUrl).pathname;
          delete all[pageKey];
          chrome.storage.local.set({ [STORAGE_KEY]: all }, resolve);
        });
      });
      currentAnnotations = [];
      renderAnnotations();
      try { await chrome.tabs.sendMessage(tab.id, { type: 'RELOAD' }); } catch {}
    } else {
      if (!confirm('全ページのアノテーションを削除しますか？')) return;
      await chrome.storage.local.remove(STORAGE_KEY);
      currentAnnotations = [];
      renderAllPages();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try { await chrome.tabs.sendMessage(tab.id, { type: 'RELOAD' }); } catch {}
      }
    }
    updateButtonState();
  });

  // --- Init ---

  loadFromTab();
  updateButtonState();
})();
