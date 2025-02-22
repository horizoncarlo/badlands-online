function focusChatIn() {
  document.getElementById('chatIn')?.focus();
}

function scrollChatToBottom(ele) {
  Alpine?.nextTick(() => {
    if (!ele) {
      ele = document.getElementById('chatScroll');
    }

    if (ele) {
      ele.scrollTop = ele.scrollHeight;
    }
  });
}

function submitChat(ele, currentChat) {
  const toSend = {
    text: currentChat,
  };

  if (typeof lobby !== 'undefined') {
    toSend.sender = lobby.playerName;
  }

  action.chat(toSend);
  ele.value = '';
}

window.addEventListener('keyup', (event) => {
  if (!event || document.activeElement?.tagName === 'INPUT') { // Skip hotkeys if we're typing in an input field
    return;
  }

  if (event.key.toLowerCase() === 't') {
    focusChatIn();
  }
});
