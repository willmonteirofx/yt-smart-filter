// Função para atualizar o badge
function updateBadge(count, isEnabled = true) {
  if (!isEnabled) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#6c757d' });
    return;
  }
  
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Listener para mensagens do content script e popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateBadge") {
    // Verificar se a extensão está ativa antes de atualizar o badge
    chrome.storage.sync.get(['extensionEnabled'], function(result) {
      const isEnabled = result.extensionEnabled !== false;
      updateBadge(request.count, isEnabled);
    });
  }
  
  if (request.action === "updateExtensionState") {
    // Atualizar o badge baseado no novo estado da extensão
    chrome.storage.local.get(['hiddenVideos'], function(result) {
      const count = result.hiddenVideos ? result.hiddenVideos.length : 0;
      updateBadge(count, request.enabled);
    });
  }
});

// Inicializar badge ao carregar a extensão
chrome.storage.sync.get(['extensionEnabled'], function(result) {
  const isEnabled = result.extensionEnabled !== false;
  
  chrome.storage.local.get(['hiddenVideos'], function(result) {
    const count = result.hiddenVideos ? result.hiddenVideos.length : 0;
    updateBadge(count, isEnabled);
  });
}); 