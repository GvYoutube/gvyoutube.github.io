const startOverlay = document.getElementById('start-overlay');
const startButton = document.getElementById('start-button');
const audio = document.getElementById('modem-song');
const animationContainer = document.getElementById('animation-container');

const introFrames = [
    { time: 0, text: 'DIALING...' },
        { time: 1500, text: 'DIALING...<br>ATDT 1-800-WEBTVSERVICE' },
            { time: 3000, text: 'HANDSHAKING...' },
                { time: 5000, text: 'HANDSHAKING...<br>PLEASE WAIT' },
                    { time: 6000, text: 'CONNECTED!' },
                    ];

                    const loopFrames = [
                        { text: 'WELCOME TO THE WORLD WIDE WEB' },
                            { text: `
                              *        *        *        *
                              *   *    *   *    *   *    *   *
                               * *      * *      * *      * *
                               