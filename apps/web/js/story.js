/* Copyright (c) 2026 poboll · story reveal behavior */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var colorModes = {
    layer: '叠色让六种基础颜料彼此借色，显出更深、更暖或更冷的层次。',
    dots: '网点用不同密度的微小色点铺开明暗，把中间调交给眼睛完成。',
    dither: '抖动把色点有序打散，让渐变更平滑，减少色带断层。'
  };

  function bootColorLab() {
    var lab = document.querySelector('[data-color-lab]');
    if (!lab) return;
    var caption = lab.querySelector('.color-lab-caption');
    var buttons = lab.querySelectorAll('.color-mode');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timer = null;
    var modes = ['layer', 'dots', 'dither'];

    function stopCycle() {
      if (timer) window.clearTimeout(timer);
      timer = null;
    }

    function scheduleCycle() {
      stopCycle();
      if (reduceMotion || document.hidden) return;
      timer = window.setTimeout(function () {
        var current = modes.indexOf(lab.dataset.mode);
        setMode(modes[(current + 1) % modes.length], false);
      }, 4800);
    }

    function setMode(mode, focusButton) {
      if (!colorModes[mode]) return;
      lab.dataset.mode = mode;
      buttons.forEach(function (button) {
        var active = button.dataset.mode === mode;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('is-active', active);
        if (active && focusButton) button.focus();
      });
      if (caption) caption.textContent = colorModes[mode];
      scheduleCycle();
    }

    buttons.forEach(function (button) {
      button.addEventListener('click', function () { setMode(button.dataset.mode, false); });
      button.addEventListener('focus', stopCycle);
      button.addEventListener('blur', scheduleCycle);
    });
    lab.addEventListener('mouseenter', stopCycle);
    lab.addEventListener('mouseleave', scheduleCycle);
    document.addEventListener('visibilitychange', scheduleCycle);
    setMode(lab.dataset.mode || 'layer', false);
  }

  function boot() {
    var nodes = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (node) { node.classList.add('is-visible'); });
      bootColorLab();
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .14, rootMargin: '0px 0px -8% 0px' });
    nodes.forEach(function (node, index) {
      node.style.transitionDelay = Math.min(index * 55, 280) + 'ms';
      observer.observe(node);
    });
    bootColorLab();
  }
  window.addEventListener('DOMContentLoaded', boot);
}());
