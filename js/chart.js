/**
 * chart.js — Chart.js v4 historical rate chart with interactive click-to-apply rate.
 */

(function () {
  'use strict';

  let chartInstance = null;
  let currentWindow = '10Y';
  let currentUserRate = 7.00;
  let onRateSelectedCallback = null;

  // Custom inline plugin for "Your Rate" horizontal dashed line
  const userRateLinePlugin = {
    id: 'userRateLine',
    afterDraw(chart) {
      if (currentUserRate === null || isNaN(currentUserRate)) return;
      const { ctx, chartArea, scales } = chart;
      if (!chartArea || !scales || !scales.y) return;

      const yPos = scales.y.getPixelForValue(currentUserRate);
      if (yPos < chartArea.top - 5 || yPos > chartArea.bottom + 5) return;

      ctx.save();
      ctx.strokeStyle = '#f59e0b'; // amber dashed line
      ctx.lineWidth = 1.75;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yPos);
      ctx.lineTo(chartArea.right, yPos);
      ctx.stroke();

      // Pill badge / label
      const labelText = `Your Rate: ${Number(currentUserRate).toFixed(2)}%`;
      ctx.font = '600 11px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      const textWidth = ctx.measureText(labelText).width;
      const badgeX = chartArea.right - textWidth - 16;
      const badgeY = yPos > chartArea.top + 22 ? yPos - 20 : yPos + 6;

      ctx.fillStyle = 'rgba(26, 32, 44, 0.85)';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.roundRect(badgeX - 4, badgeY - 2, textWidth + 8, 16, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(labelText, badgeX, badgeY);
      ctx.restore();
    }
  };

  function initChart(canvasId, onRateSelected) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    onRateSelectedCallback = onRateSelected;

    const ctx = canvas.getContext('2d');

    // Register our custom plugin
    window.Chart.register(userRateLinePlugin);

    chartInstance = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: '30-Year Fixed Rate',
          data: [],
          borderColor: '#00c6ff',
          borderWidth: 2.5,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#00c6ff',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        onClick: (event, elements) => {
          if (!elements || elements.length === 0) return;
          const index = elements[0].index;
          const currentData = window.RateDataService.getRatesForWindow(currentWindow);
          if (currentData && currentData[index]) {
            const selected = currentData[index];
            if (typeof onRateSelectedCallback === 'function') {
              onRateSelectedCallback(selected.rate30yr, selected.date);
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#38bdf8',
            borderColor: 'rgba(56, 189, 248, 0.3)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            titleFont: { family: 'Inter', size: 12, weight: '600' },
            bodyFont: { family: 'Inter', size: 13, weight: 'bold' },
            callbacks: {
              title: (items) => {
                if (!items || items.length === 0) return '';
                return `Week of ${items[0].label}`;
              },
              label: (item) => {
                return ` 30-Yr Rate: ${Number(item.raw).toFixed(2)}%`;
              },
              afterBody: () => {
                return '\n⚡ Click point to apply this rate';
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              tickColor: 'transparent'
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 11 },
              maxTicksLimit: 8,
              maxRotation: 0
            }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.05)',
              tickColor: 'transparent'
            },
            ticks: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 11 },
              callback: (value) => `${value}%`
            }
          }
        }
      }
    });

    renderChart();
  }

  function setWindow(windowStr) {
    currentWindow = windowStr;
    renderChart();
  }

  function setUserRate(rate) {
    currentUserRate = parseFloat(rate);
    if (chartInstance) {
      chartInstance.update('none'); // Update without animation
    }
  }

  function renderChart() {
    if (!chartInstance || !window.RateDataService) return;

    const data = window.RateDataService.getRatesForWindow(currentWindow);
    if (!data || data.length === 0) return;

    const labels = data.map(d => d.date);
    const rates = data.map(d => d.rate30yr);

    // Dynamic gradient
    const ctx = chartInstance.ctx;
    const chartArea = chartInstance.chartArea;

    let gradientStroke = '#00c6ff';
    let gradientFill = 'rgba(0, 198, 255, 0.12)';

    if (chartArea) {
      const gStroke = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
      gStroke.addColorStop(0, '#00c6ff');
      gStroke.addColorStop(1, '#7b2ff7');
      gradientStroke = gStroke;

      const gFill = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gFill.addColorStop(0, 'rgba(0, 198, 255, 0.25)');
      gFill.addColorStop(0.8, 'rgba(123, 47, 247, 0.05)');
      gFill.addColorStop(1, 'rgba(123, 47, 247, 0)');
      gradientFill = gFill;
    }

    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = rates;
    chartInstance.data.datasets[0].borderColor = gradientStroke;
    chartInstance.data.datasets[0].backgroundColor = gradientFill;

    chartInstance.update();
  }

  window.RateChart = {
    init: initChart,
    setWindow,
    setUserRate,
    render: renderChart,
    getCurrentUserRate: () => currentUserRate
  };
})();
