
const express = require('express');
const WebSocket = require('ws');
const app = express();
const httpHost = 'localhost';
const httpPort = 3000;
const WSHost = '0.0.0.0';
const WSPort = 8080;
const DEBUG_LEVEL = 3 // 0, 1, 2, or 3
console.log(`Debug level: ${DEBUG_LEVEL}`)
app.use(express.static('public'))

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
let teams = {}; // "werewolf":{"DEBUG_BUM":true}

async function startGame (playerIps, deckHashy) {

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
                
            if (teams[deckHashy[key].team] === undefined) {
                teams[deckHashy[key].team] = {}
            }
            teams[deckHashy[key].team][key] = true;
            
            for (let i = 0; i < deckHashy[key].count; i++) {
                console.log(
                    shuffledDeck.length >= PLAYER_COUNT + 3 ?
                    'Shuffed deck is full. skipping this loop...'
                    : `Shuffed deck is not full. adding ${i === 0 ? key : 'another ' + key} to shuffed deck...`)
                if (shuffledDeck.length === PLAYER_COUNT + 3) break;
                shuffledDeck.push(key);
            };
        };
    };

    if (DEBUG_LEVEL > 0) { 
        console.log('rolesActiveStatus:');
        console.log(rolesActiveStatus);
    }

    if (DEBUG_LEVEL > 0) { 
        console.log('teams:');
        console.log(teams);
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
    const DEBUG_ROLE = "werewolf";
    let playerHashy = {};
    for (let key in playerIps) {
        if (playerIps.hasOwnProperty(key)) {
            playerHashy[playerIps[key]] = {}; 
            let card = ''; 
            if (DEBUG_LEVEL !== undefined) {
                console.log(`Debug role override to ${DEBUG_ROLE}`);
                card = DEBUG_ROLE;
                const index = shuffledDeck.indexOf(DEBUG_ROLE);
                shuffledDeck.splice(index,1);
            } else {
                card = shuffledDeck.pop();
            }
            playerHashy[playerIps[key]].card = card
            playerHashy[playerIps[key]].role = playerHashy[playerIps[key]].card;
            playerHashy[playerIps[key]].team = DECK_DATA[card].team;
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
    let roleCompletionStatus = {};
    let selection = {};

    for (let i = 0; i < deckOrder.length; i++) {
        const CARD = deckOrder[i];
        if (DEBUG_LEVEL > 1) console.log(`going through the night actions of ${CARD}...`)
        if (!rolesActiveStatus[CARD]) {
            if (DEBUG_LEVEL > 1) console.log(`${CARD} isn't active.`)
            continue
        };
        if (roleHashy[CARD] === undefined) {

            console.log('Role is not in play. Continuing...')
            roleCompletionStatus[deckOrder.indexOf(CARD)] = true;
            continue;}
        
        const ws = ipWsMap[playerHashy[roleHashy[CARD]].ip];
        ws.send(`You are ${deckHashy[CARD].count > 1 ? 'a' : 'the'} ${CARD}`);

        // this took 8 hours for me to properly code and i still barely get it. so ashamed
        // add another 8 hours cause i didnt understand shit
        async function selectFromTargets(ip,targets,stateDependencies,step) { // targets = {'1':true,'2':true}
            // center, were-center, player-cards, all-cards, tokens
            const DEPEND_DATA = stateActionDependencies[deckOrder.indexOf(playerHashy[playerIps[ip]].role)];
            for (let dependency of stateDependencies) {
                console.log(`checking dependency ${dependency} of ${playerHashy[playerIps[ip]].role}...`)
                if (DEPEND_DATA[dependency] === -1) {
                    console.log(`dependency clear.`)
                    continue;
                }
                while (!roleCompletionStatus[DEPEND_DATA[dependency]]) {
                    if (DEBUG_LEVEL > 2) console.log(`Waiting on ${DEPEND_DATA[dependency]} for ${dependency}...`)
                    await new Promise(res => setTimeout(res, 1000))
                }
                console.log(`dependency clear.`)
            }
            function callbackNest (event) {
                selectPlayerWebsocketEvent(event,targets)
            }
            function selectPlayerWebsocketEvent (event,targetHashmap){
                const MESSAGE = JSON.parse(event.data).content;
                console.log('Selection event caught message: ' + MESSAGE)
                if (targetHashmap[MESSAGE] !== undefined) {
                    responseLog[playerIps[ip]] = MESSAGE;
                    ipWsMap[ip].send(
                        `${centerCards[MESSAGE] === undefined ?
                        `${playerHashy[MESSAGE].ip} (${MESSAGE})`:
                        MESSAGE} selected.`
                    )
                    ipWsMap[ip].removeEventListener("message",callbackNest)
                } else {
                    ipWsMap[ip].send("invalid response. please try again")
                }
            }
            //ipWsMap[ip].send(step.flavor || `please type any of the following values: ${Object.keys(targets)}`)
            ipWsMap[ip].addEventListener("message",callbackNest)
            console.log(`Awaiting response from ${ip} ...`)
            while (!targets[responseLog[playerIps[ip]]]) {
                if (DEBUG_LEVEL > 2) console.log(`No response detected from ${ip}`)
                await new Promise(res => setTimeout(res, 1000))
            }
            if (selection[playerIps[ip]] === undefined) {
                selection[playerIps[ip]] = [];
            }
            selection[playerIps[ip]].push(responseLog[playerIps[ip]])
            if (DEBUG_LEVEL > 1) console.log(`Valid response detected from ${ip}. Removing event listener and returning...`)
            if (DEBUG_LEVEL > 0) console.log(`${ip} completed step with target ${
                centerCards[responseLog[playerIps[ip]]] === undefined ?
                `#${playerHashy[responseLog[playerIps[ip]]].ip}` :
                `${responseLog[playerIps[ip]]} (center cards)`}.`)
            responseLog[playerIps[ip]] = undefined;
        }

        async function completeRole(CARD) {
            const playerId = roleHashy[CARD][0];
            const STEPS = deckHashy[CARD].nightSteps;
            async function completeStep(stepIndex) {
                const STEP = STEPS[stepIndex]
                const ws = ipWsMap[playerHashy[playerId].ip]
                let flavor = STEP.flavor;

                if (STEP.conditions !== undefined ) {
                    for (let c in STEP.conditions){
                            console.log(`STEP.conditions[c]: ${STEP.conditions[c]} || STEP.conditions: ${STEP.conditions}`)
                            result = checkCondition(STEP.conditions[c]);
                            console.log(`result of condition ${STEP.conditions[c]}: ${result}`)
                            if (!result) {
                                console.log(`step condition invalid. skipping...`)
                                if (stepIndex >= STEPS.length - 1) {
                                    console.log()
                                    roleCompletionStatus[deckOrder.indexOf(CARD)] = true;
                                    console.log(`${CARD} is complete.`);
                                    return
                                }
                                console.log(`current selection: ${JSON.stringify(selection).replaceAll('"',"")}`)
                                completeStep(++stepIndex)
                                return
                            }
                        }
                        console.log('step conditions met. running step...')
                }

                function checkCondition (condition){
                    switch (condition) {
                        case 'MULTIPLE_TARGETS': 
                            if (STEP.target === 'team') {
                                return Object.keys(teams[deckHashy[CARD].team]).length > 2;
                            }
                        break;
                        case 'SINGULAR_TARGET': 
                            if (STEP.target === 'team') {
                                return Object.keys(teams[deckHashy[CARD].team]).length === 2;
                            }
                        break;
                        case 'NO_TEAMMATES': 
                          return Object.keys(teams[deckHashy[CARD].team]).length === 1;
                        break;
                        case 'SELECTION_EXISTS': 
                            return selection[playerId] !== undefined && selection[playerId].length > 0;
                        default:
                            console.log(`defaulted on checking condition ${condition} for ${CARD}`)
                            break;
                    }
                }

                let validFlavor = undefined;
                if (typeof(flavor) === 'object') {
                    console.log('flavor is an array')
                    for (let possibility of flavor) {
                        let result = true;
                        console.log(`possibility: ${JSON.stringify(possibility)}`)
                        for (let c of possibility.conditions){
                            result = checkCondition(c);
                            console.log(`result of condition ${c}: ${result}`)
                            if (!result) {
                                break;
                            }
                        }
                        if (result) {
                            console.log('test')
                            validFlavor = possibility.message
                            break;
                        }
                    }
                } else {
                    validFlavor = flavor;
                }
                
                console.log(`flavor: ${JSON.stringify(flavor)}`)
                console.log(`validFlavor: ${JSON.stringify(validFlavor)}`)
                // if flavor conditions pass, check and replace variables
                if (validFlavor !== undefined) {
                    flavor = validFlavor;
                if (selection[playerId] !== undefined) {
                if (playerHashy[selection[playerId][0]] !== undefined) {
                        if (playerHashy[selection[playerId][1]] !== undefined) {
                            flavor = flavor.replaceAll("$TARGET_PLAYER_2",`${playerNicknames[playerHashy[selection[playerId][1]].ip]}`)
                        }
                        flavor = flavor
                        .replaceAll("$TARGET_PLAYER_1",`${playerNicknames[playerHashy[selection[playerId][0]].ip]}`)
                        .replaceAll("$TARGET_CARD",`${centerCards[selection[playerId][0]] === undefined ?
                                    playerHashy[selection[playerId][0]].card : centerCards[selection[playerId][0]]}`)
                        
                        } else if (centerCards[selection[playerId][0]] !== undefined) {
                            flavor = flavor
                            .replaceAll("$TARGET_CARD",`${centerCards[selection[playerId][0]] === undefined ?
                                        playerHashy[selection[playerId][0]].card : centerCards[selection[playerId][0]]}`)
                    }
                }
                if (flavor.indexOf('$TEAMMATES') !== -1 && Object.keys(teams[deckHashy[CARD].team]).length > 1) {
                    console.log('$TEAMMATES detected in flavor')
                    let teammates = '';
                    for (let teamRole in teams[deckHashy[CARD].team]) {
                        console.log(`teamRole: ${teamRole}`)
                        if (roleHashy[teamRole] === undefined) {
                            teammates = teammates + teamRole
                            continue
                        }
                        for (let teamPlayer of roleHashy[teamRole]) {
                            if (teamPlayer === playerId) continue
                            if (teammates !== '') {
                                teammates = teammates + ', '
                            }
                            teammates = teammates + teamPlayer
                        }
                    }
                    console.log(`teammates: ${teammates}`)
                    flavor = flavor.replaceAll("$TEAMMATES",`${teammates}`)
                }
                ws.send(flavor)
            }
                
                console.log(STEPS[stepIndex])
                switch (STEP.type) {
                    case 'select':
                        switch (STEP.target) {
                            case 'anyPlayer':
                                console.log('selecting anyplayer')
                                    await selectFromTargets(
                                        playerHashy[roleHashy[CARD]].ip,
                                        playerHashy, // only needs keys but as an obj
                                        ['playerCards'],
                                        STEP
                                    )
                                break;
                            case 'anyCenter':
                                    await selectFromTargets(
                                        playerHashy[roleHashy[CARD]].ip,
                                        centerCards,
                                        ['centerCards'],
                                        STEP
                                    )
                                break;
                            default:
                                console.log(`defaulted on target "${STEP.type}.${STEP.target}"`)
                                break;
                        }
                        break;
                        
                    case 'viewSelection':
                        console.log('...')
                    break;
                    case 'swapSelection' :
                        async function awaitDependencies(stateDependencies){
                        const DEPEND_DATA = stateActionDependencies[deckOrder.indexOf(playerHashy[playerId].role)];
                        for (let dependency of stateDependencies) {
                            console.log(`checking dependency ${dependency} of ${playerHashy[playerId].role}...`)
                            if (DEPEND_DATA[dependency] === -1) {
                                console.log(`dependency clear.`)
                                continue;
                            }
                            while (!roleCompletionStatus[DEPEND_DATA[dependency]]) {
                                if (DEBUG_LEVEL > 2) console.log(`Waiting on ${DEPEND_DATA[dependency]} for ${dependency}...`)
                                await new Promise(res => setTimeout(res, 1000))
                            }
                            console.log(`dependency clear.`)
                        }}
                        switch (STEP.target) {
                            case 'selection':
                                await awaitDependencies(['centerCards','playerCards']);
                                [playerHashy[selection[roleHashy[CARD]][0]].card,playerHashy[selection[roleHashy[CARD]][1]].card] = [playerHashy[selection[roleHashy[CARD]][1]].card,playerHashy[selection[roleHashy[CARD]][0]].card]
                                console.log(`swapped ${selection[playerId][0]} with ${selection[playerId][1]}`)
                                break;
                            case 'self':
                                await awaitDependencies(['centerCards','playerCards']);
                                [playerHashy[selection[roleHashy[CARD]][0]].card,playerHashy[playerId].card] = [playerHashy[playerId].card,playerHashy[selection[roleHashy[CARD]][0]].card]
                                console.log(`swapped ${selection[playerId][0]} with ${playerId}`)
                                break;
                            default:
                                console.log(`defaulted on target "${STEP.type}.${STEP.target}"`)
                                break;
                        };
                        break;
                    case 'viewPeers':
                        switch (STEP.target) {
                                default:
                                console.log(`defaulted on target "${STEP.type}.${STEP.target}"`)
                                break;
                        }
                        break;
                    default: 
                        console.log(`defaulted on step "${STEP.type}"`)
                        break;
                };
                console.log('step completed')
                
                console.log(playerHashy)
                if (stepIndex >= STEPS.length - 1) {
                    console.log()
                    roleCompletionStatus[deckOrder.indexOf(CARD)] = true;
                    console.log(`${CARD} is complete.`);
                    return
                }
                console.log(`current selection: ${JSON.stringify(selection).replaceAll('"',"")}`)
                completeStep(++stepIndex)
            }
            completeStep(0)
        };
    completeRole(CARD)
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