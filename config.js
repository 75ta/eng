// Configuration loader for English Learning App
async function loadConfig() {
    try {
        // Try to load from .env file
        const response = await fetch('./.env');
        if (response.ok) {
            const envText = await response.text();
            const config = {};

            // Parse .env file
            envText.split('\n').forEach(line => {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // Remove quotes
                    config[key.trim()] = value.trim();
                }
            });

            return config;
        }
    } catch (error) {
        console.warn('Could not load .env file:', error);
    }

    // Fallback to default values (user should replace these with real keys)
    return {
        GEMINI_API_KEY: 'your_gemini_api_key_here',
        GROQ_API_KEY: 'your_groq_api_key_here',
        SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec'
    };
}

// Export for use in other files
window.loadConfig = loadConfig;
