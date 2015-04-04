
var uuid = require('uuid');
var _    = require('underscore');
var buf  = require('./buffer');

function Request(method, params) {
  this.method = method;
  this.params = params;
  this.id     = uuid.v4(); 
}

function Respone(result, id, error) {
  this.result = result;
  this.error  = error || null;
  this.id     = id;
}

function Notify(method, params) {
  this.method = method;
  this.params = params;
  this.id     = null;
}

function isRequest(msg) {
  return !_(msg.method).isUndefined() && _(msg.method).isString() &&
         !_(msg.params).isUndefined() && _(msg.params).isArray() &&
         !_(msg.id).isUndefined();
}

function isNotification(msg) {
  // assumes its a request
  return msg.id === null;
}

function isResponse(msg) {
  return !_(msg.result).isUndefined() &&
         !_(msg.error).isUndefined() &&
         !_(msg.id).isUndefined();
}

// private serialization of json and send
function send(socket, msg) {
  socket.write(JSON.stringify(msg));
}

function Peer(socket, reqCB, notCB, tm_wait, destroy) {
  // peer socket we're managing
  this.socket = socket;
  // socket buffer for msg formation
  this.buffer = new buf.Buffer();
  // who to call for new requests
  this.requestCB = reqCB;
  // who to call for notifications
  this.notifyCB  = notCB;
  // allow a user supplied external destruction callback
  this.destroy = destroy || function() {};
  // cache of outstanding requests
  this.requests = {};
  // incoming socket data handler
  this.socket.on('data', this.recv);
  // closed socket handler
  socket.on('end', this.dtor);
  // set a timer to check on outstanding requests
  this.time_wait = tm_wait || 10000;
}

Peer.prototype.dtor = function() {
  // Cleanup the socket
  this.socket.destroy();
  // Send timeout errors to any waiting clients
  _(this.requests).each(function(value, key) {
    value('Request timeout');
  });
  // Initiate the user supplied callback
  this.destroy();
};

Peer.prototype.timer = function() {
  // get the current time in milliseconds
  var ct = new Date().getTime();
  // invoke an error and delete any stale requests
  _(this.requests).each(function(value, key) {
    if(ct >= value.timeout) {
      value.callback('Request timed out');
      delete this.requests[key];
    }
  });
};

Peer.prototype.recv = function(data) {
  try {
    _(buffer.read(data)).each(function(msg) {
      if(isResponse(msg)) {
        this.rxResponse(msg);
      } else if(isRequest(msg)) {
        if(isNotification(msg)) {
          this.rxNotification(msg);
        } else {
          this.rxRequest(msg);
        }
      } else {
        throw ('Bad msg: '+msg);
      }
    });
  } catch(e) {
    console.log(e);
    this.dtor();
  }
};

Peer.prototype.rxRequest = function(msg) {
  this.requestCB(msg);
};

Peer.prototype.rxNotification = function(msg) {
  this.notifyCB(msg);
};

Peer.prototype.rxResponse = function(msg) {
  if(_(this.requests).has(msg.id)) {
    this.requests[msg.id].callback(msg.error, msg.result);
    delete this.requests[msg.id];
  } else {
    console.log('unknown response');
  }
};

Peer.prototype.request = function(method, params, cb) {
  // Construct the message
  var msg = new Request(method, params, cb);
  // Remember the request transaction
  this.requests[msg.id] = {
    msg: msg,
    callback: cb,
    timeout: (this.time_wait + new Date().getTime())
  };
  // Send the msg
  send(this.socket, msg);
};

Peer.prototype.response = function(result, id, error) {
  send(this.socket, new Response(result, id, error));
};

Peer.prototype.notify = function(method, params) {
  send(this.socket, new Notify(method, params));
};

exports.Peer = Peer;

