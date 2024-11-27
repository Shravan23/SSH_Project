const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const Docker = require('dockerode');
const cors = require('cors');
const path = require('path');
const stream = require('stream');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const docker = new Docker();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.post('/api/containers/create', async (req, res) => {
    try {
        console.log('Pulling Ubuntu image...');
        
        // Pull the Ubuntu image with proper stream handling
        await new Promise((resolve, reject) => {
            docker.pull('ubuntu:latest', (err, stream) => {
                if (err) return reject(err);
                
                docker.modem.followProgress(stream, (err, output) => {
                    if (err) return reject(err);
                    resolve(output);
                });
            });
        });

        console.log('Image pulled successfully, creating container...');
        
        const container = await docker.createContainer({
            Image: 'ubuntu:latest',
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            Cmd: ['/bin/bash'],
            OpenStdin: true,
            StdinOnce: false,
            name: `ubuntu-terminal-${Date.now()}`
        });

        console.log('Container created, starting it...');
        await container.start();
        
        const containerInfo = await container.inspect();
        res.json({ 
            success: true, 
            containerId: container.id,
            name: containerInfo.Name,
            state: containerInfo.State
        });
    } catch (error) {
        console.error('Detailed error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.delete('/api/containers/:id', async (req, res) => {
    try {
        const container = docker.getContainer(req.params.id);
        await container.stop();
        await container.remove();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/containers', async (req, res) => {
    try {
        const containers = await docker.listContainers({ all: true });
        res.json({ 
            success: true, 
            containers: containers.filter(container => 
                container.Image.includes('ubuntu')
            )
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    let currentContainer = null;
    let currentStream = null;

    socket.on('attach_container', async (containerId) => {
        try {
            // Clean up previous connection if exists
            if (currentStream) {
                currentStream.end();
                socket.removeAllListeners('terminal_input');
            }

            currentContainer = docker.getContainer(containerId);
            
            // Create exec instance
            const exec = await currentContainer.exec({
                AttachStdin: true,
                AttachStdout: true,
                AttachStderr: true,
                Tty: true,
                Cmd: ['/bin/bash']
            });

            // Start exec instance and attach to it
            const stream = await exec.start({
                Tty: true,
                stdin: true,
                stdout: true,
                stderr: true,
                hijack: true
            });

            currentStream = stream;

            // Handle stream data
            stream.on('data', (chunk) => {
                if (socket.connected) {
                    socket.emit('terminal_output', chunk.toString('utf8'));
                }
            });

            // Handle stream end
            stream.on('end', () => {
                if (socket.connected) {
                    socket.emit('terminal_output', '\r\nConnection closed\r\n');
                }
                currentStream = null;
            });

            // Handle terminal input
            socket.on('terminal_input', (data) => {
                if (currentStream && !currentStream.destroyed) {
                    const buffer = Buffer.from(data, 'utf8');
                    currentStream.write(buffer);
                }
            });

            // Send initial prompt
            stream.write('PS1="\\w\\$ "\n');
            stream.write('clear\n');

        } catch (error) {
            console.error('Terminal connection error:', error);
            if (socket.connected) {
                socket.emit('error', error.message);
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentStream) {
            currentStream.end();
        }
        currentContainer = null;
        currentStream = null;
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 