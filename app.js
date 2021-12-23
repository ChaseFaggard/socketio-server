const Express = require('express')()
const Http = require('http').Server(Express)
const SocketIO = require('socket.io')(Http, { cors: { origins: '*' } })

/* Array of sockets and which room they are in */
let sockets = []

let games = {}

const WIDTH = 1000
const HEIGHT = 600

const DEFAULT_SPEED = 10

const dataTickRate = 30 // Tick rate per second

let increaseSpeed // Interval instance for increasing speed

/* Data Structure 
    games: Game = [{
        host: string
        players: Player[{
                name: string,
                position: {
                    x: number,
                    y: number
                },
                speed: number,
                radius: number,
                color: string
        }],
        items: Item[{
                id: number,
                position: {
                    x: number,
                    y: number
                },
                width: number,
                height: number,
                speed: number
       }],
       width: number,
       height: number
    }]
*/

/* When new socket connects */
SocketIO.on('connection', socket => {

    let room = ''

    /* Player joins room */
    socket.on('join', joinData => {
        room = joinData.room

        socket.join(room) // Place socket in specified room

        sockets[socket.id] = room // Saves the room that socket has joined inside an array

        if(games[room] == undefined) {
            games[room] = {
                host: socket.id,
                players: {},
                items: {},
                width: WIDTH,
                height: HEIGHT,
                started: false,
                startTimestamp: 0,
                countDown: 3,
                gameOver: false,
                winner: ''
            }
        }

        // Emit back startup info
        socket.emit('startinfo', {
            pid: socket.id,
            hostid: games[room].host
        })

        games[room].players[socket.id] = {
          name: joinData.name,
          position: {
              x: Math.random()*games[room].width,
              y: Math.random()*games[room].height
          },
          speed: DEFAULT_SPEED,
          color: getRandomColor(),
          radius: 20,
          keys: {
              up: false,
              down: false,
              left: false,
              right: false
          },
          alive: true
        }
        let roomCount = getRoomCount(room)
        console.log('Socket connected. Total connections: ', roomCount)
        SocketIO.to(room).emit('roomCount', roomCount)
    })

    /* Socket disconnects (Page exit or refresh) */
    socket.on('disconnect', () => {
        if(room) {
            delete games[room].players[socket.id]
            delete sockets[socket.id]
            let roomCount = getRoomCount(room)
            SocketIO.to(room).emit('roomCount', roomCount)
            if(roomCount == 0) {
                console.log('All players left. Deleting room: ' + room)
                delete games[room]
                clearInterval(increaseSpeed)
            } else console.log('Socket disconnected. Total connections: ', roomCount)
        }
    })

    socket.on('start', () => { 
        startGame(room)
    })

    socket.on('keydown', direction => {
        if(room) {
            switch(direction) {
                case 'up':
                    games[room].players[socket.id].keys.up = true
                    break
                case 'down':
                    games[room].players[socket.id].keys.down = true
                    break
                case 'right':
                    games[room].players[socket.id].keys.right = true
                    break
                case 'left':
                    games[room].players[socket.id].keys.left = true
                    break
            }
        }
    })

    socket.on('keyup', direction => {
        if(room) {
            switch(direction) {
                case 'up':
                    games[room].players[socket.id].keys.up = false
                    break
                case 'down':
                    games[room].players[socket.id].keys.down = false
                    break
                case 'right':
                    games[room].players[socket.id].keys.right = false
                    break
                case 'left':
                    games[room].players[socket.id].keys.left = false
                    break
            }
        }
    })
})

/* GAME LOOP - Emits gamestate information on an interval */
setInterval(() => {
    for(let room of Object.keys(games)) {
        checkHost(room) /* Changes host if the current host disconnected */
        updatePlayers(room)
        if(!games[room].gameOver && games[room].started) {
            updateItems(room)
            collisionDetection(room)
            checkGameOver(room)
        }
        SocketIO.to(room).emit('gameState', games[room])
    }
}, 1000 / dataTickRate)

Http.listen(3000, () => {
    console.log('Listening on port :3000. . .')
})

startGame = room => {
    if(getRoomCount(room) > 1) {

        // Reset values
        games[room].gameOver = false
        games[room].started = true
        games[room].startTimestamp = new Date().getTime()
        games[room].items = {}

        // Check to see if there is a winner and they are still in the lobby
        let winner = games[room].winner
        if(winner && games[room].players[winner]) { 
            games[room].players[winner].speed = DEFAULT_SPEED
            games[room].winner = ''
        }

        // Make everyone alive again
        for(let key of Object.keys(games[room].players)) {
            games[room].players[key].alive = true
        }

        // Start game interval
        setTimeout(() => {
            games[room].items = getItems() 
            clearInterval(increaseSpeed)
            /* Game progression every 10 seconds */
            increaseSpeed = setInterval(() => {
                increaseItemSpeed(room, 5)
            }, 10000)

        }, games[room].countDown * 1000)
    }
}

getRoom = id => sockets[id]

getRoomCount = room => Object.keys(games[room].players).length

getPlayer = (room,id) => games[room].players[id]

getRandomColor = () => {
    let r = Math.random()*255>>0
    let g = Math.random()*255>>0
    let b = Math.random()*255>>0
    return "rgba(" + r + ", " + g + ", " + b + ", 0.9)"
}

getItems = (room) => {
    let items = {}
    let itemCount = 15
    for(let i = 0; i < itemCount; i++) {
        let size = getRandomInt(30,50)
        items[i] = {
            id: getRandomInt(0,4),
            position: {
                x: Math.random()*WIDTH + 20,
                y: Math.random()*-200
            },
            speed: (Math.random()*7)+3,
            width: size,
            height: size
        }
    }
    return items
}

updateItems = (room) => {
    for(let i = 0; i < Object.keys(games[room].items).length; i++) {
        if(games[room].items[i].position.y > HEIGHT) resetItem(room, i)
        else games[room].items[i].position.y += games[room].items[i].speed
    }
}

increaseItemSpeed = (room, speed) => {
    for(let i = 0; i < Object.keys(games[room].items).length; i++) {
        games[room].items[i].speed += speed
    }
}

updatePlayers = (room) => {
    for(let [key, p] of Object.entries(games[room].players)) {
        if(p.alive) {
            if(p.keys.up && p.position.y > 0+p.radius+20) games[room].players[key].position.y -= p.speed
            if(p.keys.down && p.position.y < games[room].height-p.radius-5) games[room].players[key].position.y += p.speed
            if(p.keys.left && p.position.x > 0+p.radius+5) games[room].players[key].position.x -= p.speed
            if(p.keys.right && p.position.x < games[room].width-p.radius-5) games[room].players[key].position.x += p.speed
        }  
    }
}


collisionDetection = (room) => {
    // Check to see if any player is touching any item (Collision)
    for(let i = 0; i < Object.keys(games[room].items).length; i++) { // Loop through each item
        for(let [key,player] of Object.entries(games[room].players)) { // Loop through each player
            if(player.alive) {
                let item = games[room].items[i]

                let circle = {x:player.position.x, y:player.position.y, radius:player.radius}
                let rect = {x:item.position.x, y:item.position.y, width:item.width, height:item.height}

                if(collisionCheckCircleRect(circle, rect)) { // Collision Occurs
                    resetItem(room, i)
                    games[room].players[key].alive = false
                }
            }
        }
    }
}

collisionCheckCircleRect = (circle, rect) => {
    var distx = Math.abs(circle.x - rect.x);
    var disty = Math.abs(circle.y - rect.y);

    if (distx > (rect.width/2 + circle.radius)) { return false; }
    if (disty > (rect.height/2 + circle.radius)) { return false; }

    if (distx <= (rect.width/2)) { return true; } 
    if (disty <= (rect.height/2)) { return true; }

    var hypot = (distx - rect.width/2)*(distx- rect.width/2) +
                         (disty - rect.height/2)*(disty - rect.height/2);

    //console.log(hypot <= (circle.radius*circle.radius))
    return (hypot <= (circle.radius*circle.radius));
}

/* Checks if there is a winner (1 person left alive) */
checkGameOver = (room) => {
    let aliveCounter = 0
    let winnerId = ''
    for(let [key, p] of Object.entries(games[room].players)) {
        if(p.alive) { 
            aliveCounter++
            winnerId = key
        }
    }
    if(aliveCounter == 1) {
        console.log(`${games[room].players[winnerId].name} won in lobby ${room}`)
        games[room].winner = winnerId
        games[room].gameOver = true
        
        /* Enhance winner for fun */
        games[room].players[winnerId].speed = 20
    }
}

resetItem = (room, i) => {
    games[room].items[i].position.x = (Math.random()*WIDTH)+20
    games[room].items[i].position.y = Math.random()*-200
}


/* Changes host to new player (First one found) if current host left */
checkHost = (room) => {
    let host = games[room].host
    if(sockets[host] == undefined) {
        games[room].host = Object.keys(games[room].players)[0]
    }
}

/* Generates random int from min - max range */
getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1) + min)