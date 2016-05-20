(function(window) {
  if (typeof window === 'undefined' || typeof window.Worker !== 'undefined') return;
  if (console && console.log) console.log('!! Using web worker fallback');

  var WW_CONTEXT_WHITELIST = [
    'setTimeout', 'setInterval', 'XMLHttpRequest',
    'navigator', 'location', 'clearTimeout', 'clearInterval',
    'applicationCache', 'importScripts', 'Worker', 'console' /*, 'Blob'*/
  ];

  function importScript(worker_context, script_path) {
    var req = window.XMLHttpRequest ?
      new XMLHttpRequest() : new ActiveXObject("Microsoft.XMLHTTP");

    if (req === null) {
      throw new Error("XMLHttpRequest failed to initiate.");
    }

    req.open("GET", script_path, false);
    req.send(null);

    if (req.status !== 200) {
      throw new Error('Cannot import script (status code ' + req.status + '): ' + script_path);
    }

    scopedEval.call(worker_context, req.responseText);
  }

  function scopedEval(scr) {
    var context = this;
    var mask = {};
    var p;

    // window context
    var allowed_globals = {};
    for (p in WW_CONTEXT_WHITELIST) {
      allowed_globals[WW_CONTEXT_WHITELIST[p]] = true;
    }
    for (p in window) {
      if (!allowed_globals[p]) {
        mask[p] = "[[ Can't use window context in web worker! ]]";
      }
    }
    // worker context
    for (p in this)
      mask[p] = this[p];
    // set self context
    mask['self'] = this;
    mask['doEvents'] = function(cb) {
      // defer to other things on the call stack
      setTimeout(function() { if (cb) cb(); }, 0);
    }

    mask['importScripts'] = function() {
      for (var i = 0; i < arguments.length; i++) {
        importScript(context, arguments[i]);
      }
    };

    // execute script within scope
    var fn = (new Function( "with(this) { (function(){" + scr + "})(); }"));
    fn.call(mask);
    // end scopedEval
  }

  window.Worker = function(worker_path) {
    var me = this;
    var worker_loaded = false;
    var data_uri_code = null;
    var worker_context;

    if (worker_path.match(/^data:/)) {
      if (worker_path.match(/^data:text\/javascript(;charset=utf-8)?,/)) {
        data_uri_code = worker_path.substr(worker_path.indexOf(',') + 1);
        data_uri_code = decodeURI(data_uri_code);
      } else {
        throw new Error('Web worker fallback does not support data URIs.');
      }
    }

    // Allow main thread to specify event listeners
    var ui_listeners = {};
    this.addEventListener = function(event_name, fn) {
      // listen for events from worker thread
      if (!ui_listeners[event_name])
        ui_listeners[event_name] = [];
      ui_listeners[event_name].push(fn);
    }

    // onmessage handler
    this.addEventListener('message', function(e) {
      if (typeof me.onmessage !== 'undefined') {
        me.onmessage(e);
      }
    });

    /**** Worker context accessible to worker *****/
    function WorkerContext() {
      var worker_listeners = {};
      this.addEventListener = function(event_name, fn) {
        // listen for events from UI thread
        if (!worker_listeners[event_name])
          worker_listeners[event_name] = [];
        worker_listeners[event_name].push(fn);
      }

      // onmessage handler
      this.addEventListener('message', function(e) {
        if (typeof worker_context.onmessage !== 'undefined') {
          try {
            worker_context.onmessage(e);
          } catch (error) {
            triggerEvent(ui_listeners, 'error', error, true);
          }
        }
      });

      this.postMessage = function(msg) {
        triggerEvent(ui_listeners, 'message', msg);
      }

      this.__processPostMessage = function(msg) {
        triggerEvent(worker_listeners, 'message', msg);
      }

      this.close = function() { }
    }
    worker_context = new WorkerContext();

    this.postMessageQueue = [];

    this.postMessage = function(msg) {
      this.postMessageQueue.push(msg);

      waitForWorkerLoaded(function() {
        var message;
        while (me.postMessageQueue.length > 0) {
          message = me.postMessageQueue.shift();
          worker_context.__processPostMessage(message);
        }
      });
    }

    this.terminate = function() { }

    function waitForWorkerLoaded(callback) {
      (function poll() {
        if (worker_loaded) {
          callback();
          return;
        }
        setTimeout(poll, 50);
      })();
    }

    function triggerEvent(listeners_map, event_name, event_data, no_wrapping) {
      var event_obj = no_wrapping ? event_data : { data: event_data };

      if (!listeners_map[event_name]) return;
      for (var i=0; i < listeners_map[event_name].length; i++) {
        listeners_map[event_name][i](event_obj);
      }
    }

    if (data_uri_code) {
      setTimeout(function() {
        scopedEval.call(worker_context, data_uri_code);
        worker_loaded = true;
      }, 0);
      return;
    }

    /***** Load and evaluate remote js file ****/
    var req = window.XMLHttpRequest ?
      new XMLHttpRequest() : new ActiveXObject("Microsoft.XMLHTTP");
    if(req === null) {
      throw new Error("XMLHttpRequest failed to initiate.");
    }
    req.onload = function() {
      scopedEval.call(worker_context, req.responseText);
      worker_loaded = true;
    }
    req.open("GET", worker_path, true);
    req.send(null);
  }
})(window);
