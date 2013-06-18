

function LayerDefinition(layerDefinition, options) {

  this.options = _.defaults(options, {
    ajax: $.ajax,
    pngParams: ['map_key', 'api_key', 'cache_policy', 'updated_at'],
    gridParams: ['map_key', 'api_key', 'cache_policy', 'updated_at'],
    cors: this.isCORSSupported(),
    btoa: this.isBtoaSupported() ? this._encodeBase64Native : this._encodeBase64
  });

  this.setLayerDefinition(layerDefinition, { silent: true });
  this.layerToken = null;
  this.urls = null;
  this.silent = false;
  this._layerTokenQueue = [];
  this._timeout = -1;
  this._queue = [];
  this._waiting = false;
}

LayerDefinition.prototype = {

  /*
   * TODO: extract these two functions to some core module 
   */
  isCORSSupported: function() {
    return 'withCredentials' in new XMLHttpRequest() || typeof XDomainRequest !== "undefined";
  },

  isBtoaSupported: function() {
    return typeof window['btoa'] == 'function';
  },

  getLayerCount: function() {
    return this.layers.length;
  },

  setLayerDefinition: function(layerDefinition, options) {
    options = options || {};
    this.version = layerDefinition.version || '1.0.0';
    this.stat_tag = layerDefinition.stat_tag;
    this.layers = _.clone(layerDefinition.layers);
    if(!options.silent) {
      this._definitionUpdated();
    }
  },

  toJSON: function() {
    var obj = {};
    obj.version = this.version;
    if(this.stat_tag) {
      obj.stat_tag = this.stat_tag;
    }
    obj.layers = [];
    for(var i in this.layers) {
      var layer = this.layers[i];
      if(!layer.options.hidden) {
        obj.layers.push({
          type: 'cartodb',
          options: {
            sql: layer.options.sql,
            cartocss: layer.options.cartocss,
            cartocss_version: layer.options.cartocss_version || '2.1.0',
            interactivity: layer.options.interactivity
          }
        });
      }
    }
    return obj;
  },

  _encodeBase64Native: function (input) {
    return btoa(input)
  },

  // ie7 btoa,
  // from http://phpjs.org/functions/base64_encode/
  _encodeBase64: function (data) {
    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var o1, o2, o3, h1, h2, h3, h4, bits, i = 0,
      ac = 0,
      enc = "",
      tmp_arr = [];

    if (!data) {
      return data;
    }

    do { // pack three octets into four hexets
      o1 = data.charCodeAt(i++);
      o2 = data.charCodeAt(i++);
      o3 = data.charCodeAt(i++);

      bits = o1 << 16 | o2 << 8 | o3;

      h1 = bits >> 18 & 0x3f;
      h2 = bits >> 12 & 0x3f;
      h3 = bits >> 6 & 0x3f;
      h4 = bits & 0x3f;

      // use hexets to index into b64, and append result to encoded string
      tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4);
    } while (i < data.length);

    enc = tmp_arr.join('');

    var r = data.length % 3;
    return (r ? enc.slice(0, r - 3) : enc) + '==='.slice(r || 3);
  },

  _array2hex: function(byteArr) {
    var encoded = []
    for(var i = 0; i < byteArr.length; ++i) {
      encoded.push(String.fromCharCode(byteArr[i] + 128));
    }
    return this.options.btoa(encoded.join(''))
  },

  getLayerToken: function(callback) {
    var self = this;
    clearTimeout(this._timeout);
    this._layerTokenQueue.push(callback);
    this._timeout = setTimeout(function() {
      self._getLayerToken(function(data, err) {
        var fn;
        while(fn = self._layerTokenQueue.pop()) {
          fn(data, err);
        }
      });
    }, 4);
  },

  _requestFinished: function() {
    this._waiting = false;
    if(this._queue.length) {
      this._getLayerToken(this._queue.pop());
    }
  },

  _requestPOST: function(params, callback) {
    var self = this;
    var ajax = this.options.ajax;
    ajax({
      crossOrigin: true,
      type: 'POST',
      dataType: 'json',
      contentType: 'application/json',
      url: this._tilerHost() + '/tiles/layergroup' + (params.length ? "?" + params.join('&'): ''),
      data: JSON.stringify(this.toJSON()),
      success: function(data) {
        callback(data);
        self._requestFinished();
      },
      error: function(xhr) {
        var err = { errors: ['unknow error'] };
        try {
          err = JSON.parse(xhr.responseText);
        } catch(e) {}
        callback(null, err);
        self._requestFinished();
      }
    });
  },

  _requestGET: function(params, callback) {
    var self = this;
    var ajax = this.options.ajax;
    var json = '{ "config": "' +
      JSON.stringify(this.toJSON()).replace(/"/g, '\\"') +
    '"}';
    LZMA.compress(json, 3, function(encoded) {
      encoded = self._array2hex(encoded);
      params.push("lzma=" + encodeURIComponent(encoded));
      ajax({
        dataType: 'jsonp',
        url: self._tilerHost() + '/tiles/layergroup?' + params.join('&'),
        success: function(data) {
          callback(data);
          self._requestFinished();
        },
        error: function(data) {
          var err = { errors: ['unknow error'] };
          try {
            err = JSON.parse(xhr.responseText);
          } catch(e) {}
          self._requestFinished();
        }
      });
    });
  },

  _getLayerToken: function(callback) {
    var self = this;
    var params = [];
    callback = callback || function() {};
    // if the previous request didn't finish, queue it
    if(this._waiting) {
      this._queue.push(callback);
      return this;
    }

    // setup params
    var extra_params = this.options.extra_params || {};
    var api_key = this.options.map_key || this.options.api_key || extra_params.map_key || extra_params.api_key;
    if(api_key) {
      params.push("map_key=" + api_key);
    }
    // mark as the request is being done 
    this._waiting = true;
    var req = null;
    if(this.options.cors) {
      req = this._requestPOST;
    } else {
      req = this._requestGET;
    }
    req.call(this, params, callback);
    return this;
  },

  removeLayer: function(layer) {
    if(layer < this.getLayerCount() && layer >= 0) {
      this.layers.splice(layer, 1);
      this._definitionUpdated();
    }
    return this;
  },

  getLayer: function(index) {
    return _.clone(this.layers[index]);
  },

  invalidate: function() {
    this.layerToken = null;
    this.urls = null;
    this.onLayerDefinitionUpdated();
  },

  setLayer: function(layer, def) {
    if(layer < this.getLayerCount() && layer >= 0) {
      this.layers[layer] = _.clone(def);
    }
    return this;
  },

  addLayer: function(def, layer) {
    layer = layer === undefined ? this.getLayerCount(): layer;
    if(layer <= this.getLayerCount() && layer >= 0) {
      if(!def.sql || !def.cartocss) {
        throw new Error("layer definition should contain at least a sql and a cartocss");
        return this;
      }
      this.layers.splice(layer, 0, {
        type: 'cartodb',
        options: def
      });
      this._definitionUpdated();
    }
    return this;
  },

  getTiles: function(callback) {
    var self = this;
    if(self.layerToken) {
      callback && callback(self._layerGroupTiles(self.layerToken, self.options.extra_params));
      return this;
    }
    this.getLayerToken(function(data, err) {
      if(data) {
        self.layerToken = data.layergroupid;
        self.urls = self._layerGroupTiles(data.layergroupid, self.options.extra_params);
        callback && callback(self.urls);
      } else {
        callback && callback(null, err);
      }
    });
    return this;
  },

  isHttps: function() {
    return this.options.tiler_protocol === 'https';
  },

  _layerGroupTiles: function(layerGroupId, params) {
    var subdomains = this.options.subdomains || ['0', '1', '2', '3'];
    if(this.isHttps()) {
      subdomains = [null]; // no subdomain
    }

    var tileTemplate = '/{z}/{x}/{y}';

    var grids = []
    var tiles = [];

    var pngParams = this._encodeParams(params, this.options.pngParams);
    for(var i = 0; i < subdomains.length; ++i) {
      var s = subdomains[i]
      var cartodb_url = this._host(s) + '/tiles/layergroup/' + layerGroupId
      tiles.push(cartodb_url + tileTemplate + ".png?" + pngParams );

      var gridParams = this._encodeParams(params, this.options.gridParams);
      for(var layer in this.layers) {
        grids[layer] = grids[layer] || [];
        grids[layer].push(cartodb_url + "/" + layer +  tileTemplate + ".grid.json?" + gridParams);
      }
    }

    return {
      tiles: tiles,
      grids: grids
    }

  },

  /**
   * set interactivity attributes for a layer.
   * if attributes are passed as first param layer 0 is
   * set
   */
  setInteractivity: function(layer, attributes) {

    if(attributes === undefined) {
      attributes = layer;
      layer = 0;
    }

    if(typeof(attributes) == 'string') {
      attributes = attributes.split(',');
    }

    for(var i = 0; i < attributes.length; ++i) {
      attributes[i] = attributes[i].replace(/ /g, '');
    }

    this.layers[layer].options.interactivity = attributes;
    this._definitionUpdated();
    return this;
  },

  onLayerDefinitionUpdated: function() {},

  setSilent: function(b) {
    this.silent = b;
  },

  _definitionUpdated: function() {
    if(this.silent) return;
    this.invalidate();
  },

  _tileJSONfromTiles: function(layer, urls) {
    return {
      tilejson: '2.0.0',
      scheme: 'xyz',
      grids: urls.grids[layer],
      tiles: urls.tiles,
      formatter: function(options, data) { return data; }
     };
  },

  /**
   * get tile json for layer
   */
  getTileJSON: function(layer, callback) {
    layer = layer == undefined ? 0: layer;
    this.getTiles(function(urls) {
      if(!urls) {
        callback(null);
        return;
      }
      if(callback) {
        callback(this._tileJSONfromTiles(layer, urls));
      }
    });
  },

  /**
   * Change query of the tiles
   * @params {str} New sql for the tiles
   */
  setQuery: function(layer, sql) {
    if(sql === undefined) {
      sql = layer;
      layer = 0;
    }
    this.layers[layer].options.sql = sql
    this._definitionUpdated();
  },

  getQuery: function(layer) {
    layer = layer || 0;
    return this.layers[layer].options.sql
  },

  /**
   * Change style of the tiles
   * @params {style} New carto for the tiles
   */
  setCartoCSS: function(layer, style, version) {
    if(version === undefined) {
      version = style;
      style = layer;
      layer = 0;
    }

    version = version || cdb.CARTOCSS_DEFAULT_VERSION;

    this.layers[layer].options.cartocss = style;
    this.layers[layer].options.cartocss_version = version;
    this._definitionUpdated();

  },

  _encodeParams: function(params, included) {
    if(!params) return '';
    var url_params = [];
    included = included || _.keys(params);
    for(var i in included) {
      var k = included[i]
      var p = params[k];
      if(p) {
        var q = encodeURIComponent(p);
        q = q.replace(/%7Bx%7D/g,"{x}").replace(/%7By%7D/g,"{y}").replace(/%7Bz%7D/g,"{z}");
        url_params.push(k + "=" + q);
      }
    }
    return url_params.join('&')
  },

  _tilerHost: function() {
    var opts = this.options;
    return opts.tiler_protocol +
         "://" + ((opts.user_name) ? opts.user_name+".":"")  +
         opts.tiler_domain +
         ((opts.tiler_port != "") ? (":" + opts.tiler_port) : "");
  },

  _host: function(subhost) {
    var opts = this.options;
    if (opts.no_cdn) {
      return this._tilerHost();
    } else {
      var h = opts.tiler_protocol + "://";
      if (subhost) {
        h += subhost + ".";
      }
      h += cdb.CDB_HOST[opts.tiler_protocol] + "/" + opts.user_name;
      return h;
    }
  },

  getInfowindowData: function(layer) {
    return this.options.layer_definition.layers[layer].infowindow;
  },

  containInfowindow: function() {
    var layers =  this.options.layer_definition.layers;
    for(var i = 0; i < layers.length; ++i) {
      var infowindow = layers[i].infowindow;
      if (infowindow && infowindow.fields && infowindow.fields.length > 0) {
        return true;
      }
    }
    return false;
  },

  createSubLayer: function(attrs, options) {
    this.addLayer(attrs);
    return new SubLayer(this, this.getLayerCount() - 1);
  },

  getSubLayer: function(index) {
    return new SubLayer(this, index);
  },

  getSubLayerCount: function() {
    return this.getLayerCount();
  }


};

function SubLayer(_parent, position) {
  this._parent = _parent;
  this._position = position;
  this._added = true;
}

SubLayer.prototype = {

  remove: function() {
    this._parent.removeLayer(this._position);
    this._added = false;
  },

  show: function() {
    this.set({
      hidden: false
    });
  },

  hide: function() {
    this.set({
      hidden: true
    });
  },

  setSQL: function(sql) {
    return this.set({
      sql: sql
    });
  },

  setCartoCSS: function(cartocss) {
    return this.set({
      cartocss: cartocss
    });
  },

  getSQL: function() {
    return this.get('sql');
  },

  getCartoCSS: function() {
    return this.get('cartocss');
  },

  _check: function() {
    if(!this._added) throw "sublayer was removed";
  },

  get: function(attr) {
    this._check();
    var attrs = this._parent.getLayer(this._position);
    return attrs.options[attr];
  },

  set: function(new_attrs) {
    this._check();
    var def = this._parent.getLayer(this._position);
    var attrs = def.options;
    for(var i in new_attrs) {
      attrs[i] = new_attrs[i];
    }
    this._parent.setLayer(this._position, def);
  }

}
