'use strict';

// When I close the window, hangup() function starts.
window.onbeforeunload = function(e){
	hangup();
}

// Send channel and receive channel
var sendChannel, receiveChannel;

// Variables associated with HTML5 elements
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");
var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

// Handler associated with 'Send' button
sendButton.onclick = sendData;

// Flags
var isChannelReady;
var isInitiator;
var isStarted;

// WebRTC local and remote stream
var localStream;
var remoteStream;

// Peer Connection
var pc;

// Peer Connection ICE protocol configuration and constraints
var pc_config = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]}; 
var pc_constraints = null;
var sdpConstraints = {'mandatory': {'OfferToReceiveAudio':true, 'OfferToReceiveVideo':true }};
			

//-----------------------------------------------------------------------------------------

// Prompt user for input (room name)
var room = prompt('Enter room name:');                     



// Connect to signaling server
var socket = io.connect();

// Create or join' message to signaling server
if (room !== '') {
  console.log('Create or join room', room);
  socket.emit('create or join', room);
}

//GetUserMedia()
var constraints = {video: true};

navigator.mediaDevices.getUserMedia(constraints)
.then(handleSuccess)
.catch( function(error) {
    console.log("navigator.mediaDevices.getUserMedia error: ", error);
  });

console.log('Getting user media with constraints', constraints);

// GetUserMedia() handler succes
function handleSuccess(stream) {
	localStream = stream;
	localVideo.srcObject=stream;
	console.log('Adding local stream.');
	sendMessage('got user media');
	if (isInitiator) {
		checkAndStart();
	}
}

//-----------------------------------------------------------------------------------------


// 1. SERVER ---> CLIENT

// Handle 'created' message coming back from server to initiator peer
socket.on('created', function (room){
  console.log('Created room ' + room);
  isInitiator = true;
});

// Handle 'full' message coming back from server
socket.on('full', function (room){
  console.log('Room ' + room + ' is full');
});

// Handle 'join' message coming back from server to initiator peer
socket.on('join', function (room){
  console.log('Another peer made a request to join room ' + room);
  console.log('This peer is the initiator of room ' + room + '!');
  isChannelReady = true;
});

// Handle 'joined' message coming back from server to joiner peer
socket.on('joined', function (room){
  console.log('This peer has joined room ' + room);
  isChannelReady = true;
});

// Handle 'log' message coming back from server to "console peer"
socket.on('log', function (array){
  console.log.apply(console, array);
});

// Receive message from the other peer via the signaling server 
socket.on('message', function (message){
  console.log('Received message:', message);
  if (message === 'got user media') {
        checkAndStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      checkAndStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    var candidate = new RTCIceCandidate({sdpMLineIndex:message.label,
      candidate:message.candidate});
    pc.addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

//-----------------------------------------------------------------------------------------


// 2. CLIENT ---> SERVER

// Send message to the other peer via the signaling server
function sendMessage(message){
  console.log('Sending message: ', message);
  socket.emit('message', message);
}

// Check and Start
function checkAndStart() {
  if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
    if (isInitiator) {
      doCall();
    }
  }
}

//--------------------------------------------------------------------------------------


// Peer connection and create data channel
function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pc_config, pc_constraints); 
    pc.onicecandidate = handleIceCandidate;
    console.log('Created RTCPeerConnnection with:\n' +
      '  config: \'' + JSON.stringify(pc_config) + '\';\n' +
      '  constraints: \'' + JSON.stringify(pc_constraints) + '\'.');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
      return;
  }
  pc.onaddstream = handleRemoteStreamAdded;
  pc.onremovestream = handleRemoteStreamRemoved;

  if (isInitiator) {
    try {
      // Create a reliable data channel
      sendChannel = pc.createDataChannel("sendDataChannel",
        {reliable:true});
      console.log('Created send data channel');
      console.log('readystate:' +sendChannel.readyState);

    } catch (e) {
      alert('Failed to create data channel. ');
    }
    
    sendChannel.onopen = handleSendChannelStateChange;
    sendChannel.onmessage = handleMessage;
    sendChannel.onclose = handleSendChannelStateChange;
  } else { // Joiner
    pc.ondatachannel = gotReceiveChannel;
  }
}

// Send data from a peer to the other one
function sendData() {
  var data = sendTextarea.value;
  sendTextarea.value='';
  if(isInitiator) sendChannel.send(data);
  else receiveChannel.send(data);
  console.log('Sent data: ' + data);
}

//-----------------------------------------------------------------------------------------

// Handlers

function gotReceiveChannel(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = handleMessage;
  receiveChannel.onopen = handleReceiveChannelStateChange;
  receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
  console.log('Received message: ' + event.data);
  receiveTextarea.value += event.data + '\n';
}

function handleSendChannelStateChange() {
  var readyState = sendChannel.readyState;

  console.log('Send channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
    dataChannelSend.disabled = false;
    dataChannelSend.focus();
    dataChannelSend.placeholder = "";
    sendButton.disabled = false;
  } else {
    dataChannelSend.disabled = true;
    sendButton.disabled = true;
  }
}

function handleReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.log('Receive channel state is: ' + readyState);
  // If channel ready, enable user's input
  if (readyState == "open") {
	    dataChannelSend.disabled = false;
	    dataChannelSend.focus();
	    dataChannelSend.placeholder = "";
	    sendButton.disabled = false;
	  } else {
	    dataChannelSend.disabled = true;
	    sendButton.disabled = true;
	  }
}

// ICE candidates management
function handleIceCandidate(event) {
  console.log('handleIceCandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate});
  } else {
    console.log('End of candidates.');
  }
}

// Create Offer
function doCall() {
  console.log('Creating Offer...');
  
  pc.createOffer(sdpConstraints)
  .then(setLocalAndSendMessage)
  .catch(function(error) {
	  console.log('Failed to create signaling message : ' + error.name);
  });
    
}

// Create Answer
function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(sdpConstraints)
  .then(setLocalAndSendMessage)
  .catch(function(error) {
	  console.log('Failed to create signaling message : ' + error.name);
  });  
  
  
}

// Handler success for Offer and Answer
function setLocalAndSendMessage(sessionDescription) {
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

// --------------------------------------------------------------------------------------

// Remote stream handlers

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteVideo.srcObject=event.stream;
  remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

//---------------------------------------------------------------------------------------

// Clean-up functions

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

function stop() {
  isStarted = false;
  if (sendChannel) sendChannel.close();
  if (receiveChannel) receiveChannel.close();
  if (pc) pc.close();  
  pc = null;
  sendButton.disabled=true;
}



