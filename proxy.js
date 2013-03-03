var mime = require('mime'),
    fs = require('fs'),
    url = require('url'),
    http = require('http'),
    config = global.nodeProxy.config;

function sBuffer() {
    this.buffer;
    this.size;
    this._getChunkSize = 0;
    this._isStop = false;
    this._interval;
}

sBuffer.prototype.addChunk = function(chunk) {
    if(!this.buffer) {
        this.buffer = chunk;
    } else {
        var oldBuffer = this.buffer;
        this.buffer = new Buffer(oldBuffer.length + chunk.length);
        oldBuffer.copy(this.buffer);
        chunk.copy(this.buffer, oldBuffer.length);
    }
    this.size = this.buffer.length;
    return this;
}

sBuffer.prototype.stopMark = function() {
    this._isStop = true;
}

sBuffer.prototype._getChunk = function(byteSize) {
    if(this._getChunkSize + byteSize >= this.size) {
        if(!this._isStop) return false;
        if(this._getChunkSize == this.size) {
            return false;
        }
        var buffer = this.buffer.slice(this._getChunkSize, this.size);
        this._getChunkSize = this.size;
        return buffer;
    } else {
        var buffer = this.buffer.slice(this._getChunkSize, this._getChunkSize + byteSize);
        this._getChunkSize = this._getChunkSize + byteSize;
        return buffer;
    }
}

sBuffer.prototype.isStop = function() {
    return this._getChunkSize == this.size;
}

sBuffer.prototype.send = function(byteSize, interval, response) {
    if(this._interval) return;
    var self = this;
    this._interval = setInterval(function() {
        if(self.isStop()) {
            clearInterval(self._interval);
            response.end();
        } else {
            var chunk = self._getChunk(byteSize);
            if(chunk) {
                response.write(chunk, 'binary');
            }
        }
    }, interval);
}

function _getResponseHeader() {
    var headers = {
          'Cache-Control' : 'max-age=0',
          'Content-Type' : 'text/plain'
        };
    return headers;
}

exports.reply = function(request, response) {
    var options = url.parse(request.url),
        wgetObj, postData, dataBuffers, interval;
 
    options.method = request.method;
    options.headers = request.headers;
    options.port = 80;
    if(config.focusRefresh) {
        options.headers['If-Modified-Since'] = 'Thu, 16 Aug 1970 00:00:00 GMT';
        options.headers['Cache-Control'] = 'max-age=0';
    }
 
    wgetObj = http.request(options, function(res) {
        if(config.focusRefresh) {
            res.headers['Cache-Control'] = 'max-age=0';
        }
        response.writeHead(res.statusCode, res.headers);
 
        res.on('data', function(chunk) {
            if(config.slowLoad) {
                if(!dataBuffers) {
                    dataBuffers = new sBuffer();
                }
                dataBuffers.addChunk(chunk);
                dataBuffers.send(config.slowBlockByte, config.slowTimeInterval, response);
            } else {
                response.write(chunk, 'binary');
            }
        });
 
        res.on('end', function() {
            if(config.slowLoad && dataBuffers) {
                dataBuffers.stopMark();
            } else {
                response.end();
            }
        });
 
    });
    //处理post的数据
    request.on('data', function(data) {
        if(postData) {
            postData += data;
        } else {
            postData = data;
        }
    });
 
    request.on('end',function() {
        wgetObj.write(postData || '');
        wgetObj.end();
    })
 
    //请求失败输出log
    wgetObj.on('error', function (e) {
      console.log(e);
      return;
    });
}


exports.getReplaceFile = function(request) {
    var urlObj, list = global.nodeProxy.replaceList;
    urlObj = url.parse(request.url);
    global.nodeProxy.socket.sockets.emit('realtime_send', {'id': request.proxyIndex, 'data': urlObj});
    for(var i in list) {
        if(list[i]['enabled'] && list[i].fileName.test(urlObj.href)) {
            return list[i].filePath;
        }
    }
    return false;
}

exports.replaceFile = function(filePath, response) {
    var headers = _getResponseHeader(),
        ext, fileSteam, dataBuffers;

    try {
        fileSteam = fs.readFileSync(filePath);
        ext = filePath.split('.');
        ext = ext[ext.length - 1];
        // headers['Content-Type'] = mime.lookup('ext');
    } catch(e) {
        fileSteam = filePath;
    }
    response.writeHead(200, headers);
    if(config.slowLoad) {
        if(!dataBuffers) {
            dataBuffers = new sBuffer();
        }
        dataBuffers.addChunk(fileSteam);
        dataBuffers.stopMark();
        dataBuffers.send(config.slowBlockByte, config.slowTimeInterval, response);
    } else {
       response.write(fileSteam);
       response.end();
    }
    console.log("SUCCESS: replace '" + filePath + "'");
}