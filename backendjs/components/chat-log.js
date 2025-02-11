function focusChatIn() {
  document.getElementById('chatIn')?.focus();
}

function scrollChatToBottom(ele) {
  Alpine?.nextTick(() => {
    // If we're calling without an element, aka from outside, we just want to force the scroll
    // This would be used when doing the initial chat load
    let forceScroll = false;
    if (!ele) {
      ele = document.getElementById('chatScroll');
      forceScroll = true;
    }

    if (ele) {
      // Check if we're already at (or near) the bottom, in which case we autoscroll
      // Otherwise the user might have intentionally scrolled up to read something
      const isScrolledToBottom = ele.scrollHeight - ele.clientHeight <= ele.scrollTop + 50;
      if (isScrolledToBottom || forceScroll) {
        ele.scrollTop = ele.scrollHeight;
      }
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
