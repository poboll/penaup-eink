// 风格切换功能
function initStyleSwitcher() {
    const styleSheet = document.getElementById('style-sheet');
    const styleSelector = document.getElementById('style-selector');

    const allowedStyles = new Set(['style.css', 'style_penaup_contrast.css']);
    const applyStyle = (value) => {
        const styleFile = allowedStyles.has(value) ? value : 'style.css';
        if (styleSheet) styleSheet.setAttribute('href', `../css/${styleFile}`);
        if (styleSelector) styleSelector.value = styleFile;
        document.documentElement.dataset.penaupTheme = styleFile === 'style.css' ? 'paper' : 'contrast';
        return styleFile;
    };

    let savedStyle = 'style.css';
    try {
        savedStyle = localStorage.getItem('selectedStyle') || savedStyle;
    } catch (error) {}
    savedStyle = applyStyle(savedStyle);
    try {
        localStorage.setItem('selectedStyle', savedStyle);
    } catch (error) {}

    if (styleSelector) {
        styleSelector.addEventListener('change', function() {
            const styleFile = applyStyle(this.value);
            try {
                localStorage.setItem('selectedStyle', styleFile);
            } catch (error) {}
        });
    }
}

// 页面导航功能
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const pages = document.querySelectorAll('.page');
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    // 底部导航切换
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const pageId = this.getAttribute('data-page');

            // 更新导航状态
            navItems.forEach(nav => {
                nav.classList.remove('active');
                nav.removeAttribute('aria-current');
            });
            this.classList.add('active');
            this.setAttribute('aria-current', 'page');

            // 更新页面显示
            pages.forEach(page => page.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
            window.requestAnimationFrame(() => {
                if (typeof updateCanvasScale === 'function') updateCanvasScale();
            });
        });
    });

    // 标签页切换
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');

            // 更新标签状态
            tabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // 更新内容显示
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// 初始化应用
function initApp() {
    initStyleSwitcher();
    initNavigation();
    initBluetooth();
    initConvertTool();
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', initApp);
