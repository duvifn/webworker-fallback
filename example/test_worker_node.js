var path = require('path');
global.window = {};
require('../Worker');
global.Worker = window.Worker;
//window.XMLHttpRequest = function(){};

var worker_path = path.resolve(__dirname,'test_worker.js');
var worker = new Worker(worker_path);
worker.addEventListener('message', function(msg) {
  console.log('UI thread received result:', msg.data.result);
});

worker.postMessage({
  cmd: 'say_something',
  other_var: 'foo1234'
});