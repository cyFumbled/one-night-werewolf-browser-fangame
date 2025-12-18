
const express = require('express');
const WebSocket = require('ws');
const app = express();
const httpHost = 'localhost';
const httpPort = 3000;
const WSHost = '0.0.0.0';
const WSPort = 8080;
const DEBUG_LEVEL = 3 // 0, 1, 2, or 3
console.log(`Debug level: ${DEBUG_LEVEL}`)
app.use(express.static('public'));

app.listen(httpPort, () => {
    console.log(`Https Server running on ${httpHost}:${httpPort}`);
});

const wss = new WebSocket.Server({port: 8080,host: '0.0.0.0'});
if (DEBUG_LEVEL > 0) console.log(`Websocket Server running on ${WSHost}:${WSPort}`)
function broadcast(message) {
    if (DEBUG_LEVEL > 1) console.log(`Sending every client the message "${message}"...`)
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message)
        }
    });
}

const READY_REQUIRED_RATIO = 1/2;
const DECK_NAME = 'dev';
const DECK_DATA = require(`./decks/${DECK_NAME}.json`)
console.log(`Imported "${DECK_NAME}" deck from /decks.`)

let playerLog = {};
let activePlayers = {};
let ipWsMap = {};
let numOfTotalClients = 0;
let numOfActiveClients = 0;
let numOfReadyPlayers = 0;
let readyHashy = {};
let playerNicknames = {};
let gameInProgress = false;

function startGame (playerIps, deckHashy) {

    // SETUP PHASE
    console.log('\n## SETUP PHASE')
    const PLAYER_COUNT = Object.keys(playerIps).length;
    gameInProgress = true;

    let shuffledDeck = [];
    let deckOrder = {};
    let rolesActiveStatus = {};
    let stateActionDependencies = [];
    if (DEBUG_LEVEL > 0) {
        console.log('\ndeckHashy:');
        console.log(deckHashy);
        console.log('\nplayerIps:')
        console.log(playerIps)
    }
    
    if (DEBUG_LEVEL > 1)console.log('\n\n# Filling deckOrder hashmap with structure order:role.');
    for (let key in deckHashy) {
        if (deckHashy.hasOwnProperty(key)) {
            if (DEBUG_LEVEL > 1) console.log(`${key} ${deckHashy[key].order !== undefined ? 'will' : 'will not'} be added to deckOrder`)
            if (deckHashy[key].order !== undefined) deckOrder[deckHashy[key].order] = key;
            rolesActiveStatus[key] = 
                deckHashy[key].count > 0 
                && deckHashy[key].order !== undefined 
                && shuffledDeck.length < PLAYER_COUNT + 3;

                if (DEBUG_LEVEL > 1){
                    console.log(deckHashy[key].count > 0 
                        && deckHashy[key].order !== undefined 
                        && shuffledDeck.length < PLAYER_COUNT + 3 ?
                        `Added ${key} to rolesActiveStatus.` :
                        `${key}'s role is deemed not active.`
                    );
                    console.log(shuffledDeck.length >= PLAYER_COUNT + 3 ?
                        'Shuffed deck is full, skipping this loop' :
                        'Shuffed deck is not full, going on with this loop.'
                    );
                }

                    if (shuffledDeck.length >= PLAYER_COUNT + 3) continue
            for (let i = 0; i < deckHashy[key].count; i++) {
                console.log(
                    shuffledDeck.length >= PLAYER_COUNT + 3 ?
                    'Shuffed deck is full. skipping this loop...'
                    : `Shuffed deck is not full. adding ${i === 0 ? key : 'another ' + key} to shuffed deck...`)
                if (shuffledDeck.length === PLAYER_COUNT + 3) break;
                shuffledDeck.push(key)
            };
        };
    };

    if (DEBUG_LEVEL > 0) { 
        console.log('rolesActiveStatus:');
        console.log(rolesActiveStatus);
    }


    if (DEBUG_LEVEL > 1) console.log('\n\n# Converting deckOrder from a hashmap with raw order to an array with sequential orders');
    if (DEBUG_LEVEL > 0) {
        console.log('Preformatted deckOrder:');
        console.log(deckOrder);
    }

    let deckOrderKeyArray = Object.keys(deckOrder).sort((a,b) => {return a - b;});
    let deckOrderValueArray = [];
    for (let i = 0; i < deckOrderKeyArray.length; i++) {
        deckOrderValueArray[i] = deckOrder[deckOrderKeyArray[i]]
    }
    deckOrder = deckOrderValueArray;
    deckOrderKeyArray = null;
    deckOrderValueArray = null;

    if (DEBUG_LEVEL > 0) {
        console.log('Formatted Deck order:');
        console.log(deckOrder);
    }
    

    if (DEBUG_LEVEL > 1) console.log('\n\n# Filling the stateActionDependencies array with keys for each gamestate linked to the role order number they\'re dependant on.');
    for (let i =0; i < deckOrder.length; i++) {
        if (i === 0) {
            stateActionDependencies[0] = {
                playerCards:  -1,
                centerCards:  -1,
                playerRoles: -1,
                tokens: -1
            }
            continue;
            }
            const PREVIOUS_CARD_DATA = deckHashy[deckOrder[i - 1]];
            stateActionDependencies[i] = {
                playerCards: PREVIOUS_CARD_DATA.affectsPlayerCardState ? i - 1 : stateActionDependencies[i - 1].playerCards,
                centerCards: PREVIOUS_CARD_DATA.affectsCenterCardState ? i - 1 : stateActionDependencies[i - 1].centerCards,
                playerRoles: PREVIOUS_CARD_DATA.affectsPlayerRoleState ? i - 1 : stateActionDependencies[i - 1].playerRoles,
                tokens: PREVIOUS_CARD_DATA.affectsTokenState ? i - 1 : stateActionDependencies[i - 1].tokens,
            }
    }
    
    if (DEBUG_LEVEL > 0) {
        console.log('stateActionDependencies:');
        console.log(stateActionDependencies);
    }

    // shuffle
    if (DEBUG_LEVEL > 1) console.log('\n# Shuffling shuffledDeck with the Fisher-Yates shuffle.');
    
    let currentIndex = shuffledDeck.length;
    while (currentIndex != 0) {
        let randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [shuffledDeck[currentIndex], shuffledDeck[randomIndex]] = [shuffledDeck[randomIndex], shuffledDeck[currentIndex]];
    };
    
    if (DEBUG_LEVEL > 0) {
        console.log('Shuffled shuffledDeck or whatever:');
        console.log(shuffledDeck);
    }

    if (DEBUG_LEVEL > 1) console.log('\n# Filling playerHashy (not a hashmap) with playerNumberId:{ip:ip,card:card,role:role}.');
    
    let playerHashy = {};
    for (let key in playerIps) {
        if (playerIps.hasOwnProperty(key)) {
            playerHashy[playerIps[key]] = {}; 
            playerHashy[playerIps[key]].card = shuffledDeck.pop()
            playerHashy[playerIps[key]].role = playerHashy[playerIps[key]].card;
            playerHashy[playerIps[key]].ip = key;
        }
    }

    if (DEBUG_LEVEL > 0) {
        console.log('PlayerHasy:');
        console.log(playerHashy);
    }

    if (DEBUG_LEVEL > 1) console.log('\n# Filling rolehashy (role:[playerNumberId,...]) from PlayerHashy...');
    
    let roleHashy = {};
    for (let key in playerHashy) {
        if (playerHashy.hasOwnProperty(key)) {
            if (roleHashy[playerHashy[key].role] === undefined) roleHashy[playerHashy[key].role] = []; 
            roleHashy[playerHashy[key].role].push(key);
        }
    }
    if (DEBUG_LEVEL > 0) {
        console.log('roleHashy:');
        console.log(roleHashy);
    }
    
    if (DEBUG_LEVEL > 1) console.log('\n# Rest of shuffledDeck dumped into centerCards {left:card,center:card,right:card}.');
    let centerCards = {left:shuffledDeck[0],center:shuffledDeck[1],right:shuffledDeck[2]}
    if (DEBUG_LEVEL > 0) {
    console.log('centerCards:');
    console.log(centerCards);
    }
    shuffledDeck = null;

    // NIGHT PHASE
    console.log('\n## NIGHT PHASE')

    let responseLog = {};
    for (let i = 0; i < deckOrder.length; i++) {
        const CARD = deckOrder[i];
        if (DEBUG_LEVEL > 1) console.log(`going through the night actions of ${CARD}...`)
        if (!rolesActiveStatus[CARD]) {
            if (DEBUG_LEVEL > 1) console.log(`${CARD} isn't active.`)
            continue
        };
        if (roleHashy[CARD] === undefined) continue;
        
        const ws = ipWsMap[playerHashy[roleHashy[CARD]].ip];
        ws.send(`You are ${deckHashy[CARD].count > 1 ? 'a' : 'the'} ${CARD}`);

        // this took 8 hours for me to properly code and i still barely get it. so ashamed
        async function selectAnyPlayersCard(ip,targets,step) { // targets = {'1':true,'2':true}
            function callbackNest (event) {
                selectPlayerWebsocketEvent(event,targets)
            }
            function selectPlayerWebsocketEvent (event,targetHashmap){
                const MESSAGE = JSON.parse(event.data).content;
                console.log('Selection event caught message: ' + MESSAGE)
                if (targetHashmap[MESSAGE] !== undefined) {
                    responseLog[playerIps[ip]] = MESSAGE;
                    ipWsMap[ip].send(`${playerNicknames[playerHashy[MESSAGE].ip]} (${MESSAGE}) selected.`)
                    ipWsMap[ip].removeEventListener("message",callbackNest)
                } else {
                    ipWsMap[ip].send("invalid response. please try again")
                }
            }
            ipWsMap[ip].send(step.flavor || `please type any of the following values: ${Object.keys(targets)}`)
            ipWsMap[ip].addEventListener("message",callbackNest)
            FUCKTHISSHIT = new Promise((resolve) => {
                async function stallTillResponse() {
                    console.log(`Awaiting response from ${ip} ...`)
                    while (!targets[responseLog[playerIps[ip]]]) {
                        if (DEBUG_LEVEL > 2) console.log(`No response detected from ${ip} .`)
                        await new Promise(res => setTimeout(res, 1000))
                    }
                    if (DEBUG_LEVEL > 1) console.log(`Valid response detected from ${ip}. Removing event listener and returning...`)
                    return responseLog[playerIps[ip]]
                }
                resolve(stallTillResponse().then((target)=>{console.log('Resolving..');return target;}))
            })
            FUCKTHISSHIT.then((target)=>{
                if (DEBUG_LEVEL > 0) console.log(`${ip} Resolved with target #${target}.`)
            })
        }
        
        
        const STEPS = deckHashy[CARD].nightSteps;
        for (let stepIndex = 0; stepIndex < STEPS.length; stepIndex++) {
            const STEP = STEPS[stepIndex]
            switch (STEP.type) {
                case 'select':
                    switch (STEP.target) {
                        case 'anyPlayer':
                            selectAnyPlayersCard(playerHashy[roleHashy[CARD]].ip,{1:true,2:true},STEP)
                            break;
                        default:
                            console.log(`defaulted on target "${STEP.type}.${STEP.target}"`)
                            break;
                    }
                    break;
                default: 
                    console.log(`defaulted on step "${STEP.type}"`)
                    break;
            };
        };
        
        console.log('all steps sent out. good luck')
    };
};

wss.on('connection', (ws,req) => {
    const REMOTE_IP = req.socket.remoteAddress;

    numOfActiveClients++;
    if (!playerLog[REMOTE_IP]) {
        numOfTotalClients++;
        playerLog[REMOTE_IP] = numOfActiveClients;
        playerNicknames[REMOTE_IP] = `#${numOfActiveClients}`
    }
    activePlayers[REMOTE_IP] = playerLog[REMOTE_IP];
    ipWsMap[REMOTE_IP] = ws;

    
    console.log(`Client connected: #${playerLog[REMOTE_IP]}@${req.socket.remoteAddress}`);
    
    ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        console.log("Message from client:", message.type, '-', message.content);
        if (gameInProgress) return;
        switch (message.type) {
            case 'readyState':
                if (message.content) {
                    readyHashy[REMOTE_IP] = true;
                    numOfReadyPlayers++;
                    broadcast(`client #${playerLog[REMOTE_IP]} is ready!`);
                    if (numOfReadyPlayers === Math.ceil(numOfActiveClients * READY_REQUIRED_RATIO)) {
                        broadcast(`${numOfReadyPlayers / numOfActiveClients * 100}% of players ready, preparing game...`);
                        startGame(activePlayers,DECK_DATA)
                    }
                } else {
                    readyHashy[REMOTE_IP] = null
                    numOfReadyPlayers--
                        broadcast(`client ${playerLog[REMOTE_IP]} is no longer ready!`);
                    if (numOfReadyPlayers + 1 === Math.ceil(numOfActiveClients * READY_REQUIRED_RATIO)) {
                        broadcast(`Ready percentage (${numOfReadyPlayers / numOfActiveClients * 100}%) now less than accepted (${READY_REQUIRED_RATIO * 100}%). Abandoned game.`);
                    }
                }
                break;
            case 'chatMessage':
                broadcast(`[${playerNicknames[REMOTE_IP]}]: ${message.content}`);
                break; 
            case 'nicknameSubmission':
                broadcast(`client ${playerNicknames[REMOTE_IP]} has changed their nickname to "${message.content}".`);
                playerNicknames[REMOTE_IP] = message.content;
                break;
            }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        broadcast(`Client #${playerLog[REMOTE_IP]} disconnected.`);
        numOfActiveClients--;
        activePlayers[REMOTE_IP] = undefined;
        ipWsMap[REMOTE_IP] = undefined;
        if (readyHashy[REMOTE_IP] && !gameInProgress) {
            numOfReadyPlayers--;
            if (numOfReadyPlayers + 1 === Math.ceil(numOfActiveClients * READY_REQUIRED_RATIO)) {
                broadcast(`Ready ratio (${numOfReadyPlayers}/${numOfActiveClients}) now less than accepted (${READY_REQUIRED_RATIO}). Abandoned game.`);
            }
        } else if (numOfReadyPlayers === Math.ceil(numOfActiveClients * READY_REQUIRED_RATIO)) {
            broadcast(`${numOfReadyPlayers}/${numOfActiveClients} - Preparing game...`);
        }
    });
});