/**
 * UKSimRacing Championship Widget
 * Embeddable JavaScript widget for displaying championship standings
 * 
 * Usage:
 * <script src="https://your-domain.com/championship-widget.js"></script>
 * <div id="uksimracing-championship" 
 *      data-league-id="12345" 
 *      data-season-id="67890"
 *      data-division="Overall"
 *      data-max-rows="10">
 * </div>
 */

(function() {
    'use strict';

    // Default configuration
    const DEFAULT_CONFIG = {
        apiBase: window.location.origin, // Use current domain by default
        division: 'Overall',
        maxRows: 20,
        showGap: true,
        autoRefresh: 0, // seconds, 0 = disabled
        theme: 'default',
        viewType: 'simple'
    };

    // CSS styles for the widget
    const CSS_STYLES = `
        .uksimracing-widget {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 100%;
            margin: 0;
            box-shadow: 0 2px 15px rgba(0,0,0,0.1);
            border-radius: 8px;
            overflow: hidden;
            background: white;
        }

        .uksimracing-widget * {
            box-sizing: border-box;
        }

        .uksimracing-header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 15px;
            text-align: center;
        }

        .uksimracing-header h3 {
            margin: 0;
            font-size: 1.2em;
            font-weight: 600;
        }

        .uksimracing-subtitle {
            font-size: 0.9em;
            opacity: 0.9;
            margin-top: 5px;
        }

        .uksimracing-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
        }

        .uksimracing-table th {
            background: #f8f9fa;
            padding: 12px 8px;
            text-align: left;
            font-weight: bold;
            color: #495057;
            border-bottom: 2px solid #dee2e6;
            font-size: 0.9em;
        }

        .uksimracing-table td {
            padding: 10px 8px;
            border-bottom: 1px solid #dee2e6;
            font-size: 0.9em;
        }

        .uksimracing-table tbody tr:hover {
            background: #f8f9fa;
        }

        .uksimracing-table tbody tr:nth-child(even) {
            background: #fdfdfd;
        }

        .uksimracing-position {
            font-weight: bold;
            color: #2a5298;
            text-align: center;
            width: 50px;
        }

        .uksimracing-driver {
            font-weight: 600;
            color: #212529;
        }

        .uksimracing-points {
            font-weight: bold;
            text-align: center;
            color: #28a745;
        }

        .uksimracing-gap {
            text-align: center;
            color: #6c757d;
            font-size: 0.85em;
        }

        .uksimracing-loading {
            text-align: center;
            padding: 40px;
            color: #6c757d;
        }

        .uksimracing-error {
            text-align: center;
            padding: 20px;
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            margin: 10px;
        }

        .uksimracing-footer {
            background: #f8f9fa;
            padding: 8px 15px;
            text-align: center;
            font-size: 0.8em;
            color: #6c757d;
            border-top: 1px solid #dee2e6;
        }

        .uksimracing-footer a {
            color: #2a5298;
            text-decoration: none;
        }

        .uksimracing-footer a:hover {
            text-decoration: underline;
        }

        /* Trophy icons for top 3 */
        .uksimracing-position-1::before { content: "🥇 "; }
        .uksimracing-position-2::before { content: "🥈 "; }
        .uksimracing-position-3::before { content: "🥉 "; }

        /* Responsive design */
        @media (max-width: 600px) {
            .uksimracing-header h3 {
                font-size: 1em;
            }
            
            .uksimracing-table th,
            .uksimracing-table td {
                padding: 8px 4px;
                font-size: 0.8em;
            }
        }
    `;

    class ChampionshipWidget {
        constructor(element) {
            this.element = element;
            this.config = this.parseConfig();
            this.refreshInterval = null;
            
            this.init();
        }

        parseConfig() {
            const config = { ...DEFAULT_CONFIG };
            
            // Override with data attributes
            config.leagueId = this.element.dataset.leagueId;
            config.seasonId = this.element.dataset.seasonId;
            config.division = this.element.dataset.division || config.division;
            config.maxRows = parseInt(this.element.dataset.maxRows) || config.maxRows;
            config.showGap = this.element.dataset.showGap !== 'false';
            config.autoRefresh = parseInt(this.element.dataset.autoRefresh) || config.autoRefresh;
            config.theme = this.element.dataset.theme || config.theme;
            config.apiBase = this.element.dataset.apiBase || config.apiBase;
            config.viewType = this.element.dataset.viewType || config.viewType;

            return config;
        }

        init() {
            this.injectStyles();
            this.createStructure();
            this.loadData();
            this.setupAutoRefresh();
        }

        injectStyles() {
            if (!document.getElementById('uksimracing-widget-styles')) {
                const style = document.createElement('style');
                style.id = 'uksimracing-widget-styles';
                style.textContent = CSS_STYLES;
                document.head.appendChild(style);
            }
        }

        createStructure() {
            this.element.innerHTML = '';
            this.element.className = 'uksimracing-widget';
            
            // Create iframe for championship widget
            const iframe = document.createElement('iframe');
            
            // Build iframe URL with all parameters
            const params = new URLSearchParams({
                leagueId: this.config.leagueId,
                seasonId: this.config.seasonId,
                division: this.config.division,
                viewType: this.config.viewType,
                showGap: this.config.showGap.toString()
            });

            if (this.config.maxRows && this.config.maxRows > 0 && this.config.maxRows !== 20) {
                params.append('maxRows', this.config.maxRows.toString());
            }

            if (this.config.autoRefresh > 0) {
                params.append('autoRefresh', this.config.autoRefresh.toString());
            }

            const iframeUrl = `${this.config.apiBase}/championship-widget?${params.toString()}`;
            console.log('Championship Widget iframe URL:', iframeUrl); // Debug log
            
            iframe.src = iframeUrl;
            iframe.style.cssText = `
                width: 100%;
                height: 600px;
                border: none;
                border-radius: 8px;
                background: white;
            `;
            iframe.setAttribute('frameborder', '0');
            
            this.element.appendChild(iframe);
        }

        async loadData() {
            // Data loading is now handled by the iframe
            // This method is kept for compatibility but does nothing
        }

        showError(title, message) {
            const content = document.getElementById(`content-${this.element.id}`);
            content.innerHTML = `
                <div class="uksimracing-error">
                    <strong>${title}</strong><br>
                    ${message}
                </div>
            `;
        }

        setupAutoRefresh() {
            if (this.config.autoRefresh > 0) {
                this.refreshInterval = setInterval(() => {
                    this.loadData();
                }, this.config.autoRefresh * 1000);
            }
        }

        destroy() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
            }
        }

        reload() {
            this.loadData();
        }
    }

    // Auto-initialize widgets when DOM is ready
    function initializeWidgets() {
        const widgets = document.querySelectorAll('[id^="uksimracing-championship"]');
        widgets.forEach((element, index) => {
            if (!element.id) {
                element.id = `uksimracing-championship-${index}`;
            }
            if (!element.uksr_widget) {
                element.uksr_widget = new ChampionshipWidget(element);
            }
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeWidgets);
    } else {
        initializeWidgets();
    }

    // Expose the widget class globally
    window.UKSimRacingChampionshipWidget = ChampionshipWidget;

    // Auto-initialize any existing elements
    setTimeout(initializeWidgets, 100);

})(); 