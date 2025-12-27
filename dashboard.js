const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwx8W8rZuxhpPA_LjscRzB2PattBDl3yRcCMpCNIIKK6ym3V9b42rsAATP8DSfqxVeF/exec';

const streakCountEl = document.getElementById('streak-count');
const forecastCanvas = document.getElementById('forecastChart');
const progressCanvas = document.getElementById('progressChart');

async function fetchData() {
    try {
        const response = await fetch(`${SCRIPT_URL}?page=dashboard`);
        const data = await response.json();
        calculateStreak(data);
        renderForecastChart(data);
        renderProgressChart(data);
    } catch (error) {
        console.error("Failed to load dashboard data:", error);
    }
}

function calculateStreak(data) {
    if (data.length === 0) return;
    const answeredDates = data.filter(w => w.lastAnswered).map(w => new Date(w.lastAnswered));
    const uniqueDates = [...new Set(answeredDates.map(d => d.toISOString().split('T')[0]))].sort().reverse();
    if (uniqueDates.length === 0) return;
    let streak = 0;
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
        streak = 1;
        for (let i = 0; i < uniqueDates.length - 1; i++) {
            const current = new Date(uniqueDates[i]);
            const next = new Date(uniqueDates[i+1]);
            const diff = (current - next) / (1000 * 60 * 60 * 24);
            if (diff === 1) { streak++; } else { break; }
        }
    }
    streakCountEl.textContent = streak;
}

function renderForecastChart(data) {
    const labels = [];
    const forecastData = new Array(7).fill(0);
    const today = new Date();
    for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(today.getDate() + i);
        labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
        const dateStr = date.toISOString().split('T')[0];
        forecastData[i] = data.filter(w => w.dueDate === dateStr).length;
    }
    new Chart(forecastCanvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Reviews due', data: forecastData, backgroundColor: 'rgba(54, 162, 235, 0.6)' }] },
        options: { responsive: true, maintainAspectRatio: true }
    });
}

function renderProgressChart(data) {
    const knownWordsByDay = {};
    const today = new Date();
    const labels = [];
    const progressData = [];
    for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        const knownCount = data.filter(w => w.interval > 21 && new Date(w.dueDate) > date).length;
        progressData.push(knownCount);
    }
    new Chart(progressCanvas, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Known Words', data: progressData, borderColor: 'rgba(75, 192, 192, 1)', tension: 0.1 }] },
        options: { responsive: true, maintainAspectRatio: true }
    });
}

fetchData();