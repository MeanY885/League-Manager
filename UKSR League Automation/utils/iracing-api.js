const axios = require('axios');
const crypto = require('crypto');

// iRacing API base configuration
const IRACING_BASE_URL = 'https://members-ng.iracing.com';

// iRacing password hashing function
function getNewPassword(email, password) {
    var stringToModify = (password + email.toLowerCase());
    return crypto.createHash('sha256').update(stringToModify).digest('base64');
}

// Helper function to make authenticated requests to iRacing API
async function fetchIRacingData(endpoint, authCookie) {
    try {
        console.log(`Making request to: ${IRACING_BASE_URL}${endpoint}`);
        
        // Parse the stored cookie string to extract actual cookie values
        let cleanCookies = '';
        if (authCookie) {
            // Split the authCookie and extract the actual cookie values
            const cookieParts = authCookie.split(';');
            const validCookies = [];
            
            for (const part of cookieParts) {
                const trimmed = part.trim();
                // Look for actual cookie name=value pairs (not attributes)
                if (trimmed.includes('=') && !trimmed.includes('Max-Age') && !trimmed.includes('Domain') && !trimmed.includes('Path') && !trimmed.includes('Expires')) {
                    // Extract just the name=value part
                    const cookieMatch = trimmed.match(/^([^=]+)=([^;]*)/);
                    if (cookieMatch && cookieMatch[2] && cookieMatch[2].trim() !== '') {
                        validCookies.push(`${cookieMatch[1]}=${cookieMatch[2]}`);
                    }
                }
            }
            cleanCookies = validCookies.join('; ');
        }
        
        console.log(`Using cookies: ${cleanCookies}`);
        
        const response = await axios.get(`${IRACING_BASE_URL}${endpoint}`, {
            headers: {
                'Cookie': cleanCookies,
                'User-Agent': 'UKSimRacing League Results Tool',
                'Accept': '*/*'
            },
            timeout: 30000 // 30 second timeout
        });

        // Check if response contains a link (S3 URL)
        if (response.data && response.data.link) {
            console.log(`Following S3 link: ${response.data.link}`);
            
            // Follow the S3 link to get actual data
            const s3Response = await axios.get(response.data.link, {
                timeout: 30000
            });
            
            return s3Response.data;
        }

        return response.data;
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        throw error;
    }
}

// Authenticate with iRacing API
async function authenticateWithIRacing(username, password) {
    console.log(`Authentication attempt for user: ${username}`);

    // Hash the password using iRacing's new method
    const hashedPassword = getNewPassword(username, password);
    console.log('Password hashed for authentication');

    // Authenticate with iRacing using the new method
    const authResponse = await axios.post(`${IRACING_BASE_URL}/auth`, {
        email: username,
        password: hashedPassword
    }, {
        timeout: 10000,
        headers: {
            'Accept': '*/*',
            'Content-Type': 'application/json'
        },
        withCredentials: true
    });

    console.log('Auth response status:', authResponse.status);

    // Extract cookies from response
    const setCookieHeader = authResponse.headers['set-cookie'];
    if (!setCookieHeader) {
        throw new Error('No authentication cookies received');
    }

    console.log('Received authentication cookies');

    // Return the auth cookie
    return setCookieHeader.join('; ');
}

module.exports = {
    fetchIRacingData,
    authenticateWithIRacing,
    IRACING_BASE_URL
}; 