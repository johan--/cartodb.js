// NOTE this is ONLY used for torque bundle AND the leaflet.spec.js, that assumed torque lib to be loaded)
// Depends on cartodb to be loaded and present in global namespace.
var cdb = window.cdb;
var L = cdb.L;
var _ = cdb._;
var util = cdb.core.util;
var LeafletLayerView = require('cdb/geo/leaflet/leaflet-layer-view');
var CartoDBLogo = cdb.geo.common.CartoDBLogo;

/**
 * leaflet torque layer
 */
var LeafletTorqueLayer = L.TorqueLayer.extend({

  initialize: function(layerModel, leafletMap) {
    var extra = layerModel.get('extra_params');

    var query = this._getQuery(layerModel);

    // initialize the base layers
    L.TorqueLayer.prototype.initialize.call(this, {
      table: layerModel.get('table_name'),
      user: layerModel.get('user_name'),
      column: layerModel.get('property'),
      blendmode: layerModel.get('torque-blend-mode'),
      resolution: 1,
      //TODO: manage time columns
      countby: 'count(cartodb_id)',
      sql_api_domain: layerModel.get('sql_api_domain'),
      sql_api_protocol: layerModel.get('sql_api_protocol'),
      sql_api_port: layerModel.get('sql_api_port'),
      tiler_protocol: layerModel.get('tiler_protocol'),
      tiler_domain: layerModel.get('tiler_domain'),
      tiler_port: layerModel.get('tiler_port'),
      maps_api_template: layerModel.get('maps_api_template'),
      stat_tag: layerModel.get('stat_tag'),
      animationDuration: layerModel.get('torque-duration'),
      steps: layerModel.get('torque-steps'),
      sql: query,
      visible: layerModel.get('visible'),
      extra_params: {
        api_key: extra ? extra.map_key: ''
      },
      cartodb_logo: layerModel.get('cartodb_logo'),
      attribution: layerModel.get('attribution'),
      cartocss: layerModel.get('cartocss') || layerModel.get('tile_style'),
      named_map: layerModel.get('named_map'),
      auth_token: layerModel.get('auth_token'),
      no_cdn: layerModel.get('no_cdn'),
      dynamic_cdn: layerModel.get('dynamic_cdn'),
      loop: layerModel.get('loop') === false? false: true,
      instanciateCallback: function() {
        var cartocss = layerModel.get('cartocss') || layerModel.get('tile_style');

        return '_cdbct_' + util.uniqueCallbackName(cartocss + query);
      }
    });

    LeafletLayerView.call(this, layerModel, this, leafletMap);

    // match leaflet events with backbone events
    this.fire = this.trigger;

    //this.setCartoCSS(layerModel.get('tile_style'));
    if (layerModel.get('visible')) {
      this.play();
    }

    this.bind('tilesLoaded', function() {
      this.trigger('load');
    }, this);

    this.bind('tilesLoading', function() {
      this.trigger('loading');
    }, this);

    layerModel.initBindsForTorqueLayerView(this);
  },

  onAdd: function(map) {
    L.TorqueLayer.prototype.onAdd.apply(this, [map]);
    // Add CartoDB logo
    if (this.options.cartodb_logo != false)
      CartoDBLogo.addWadus({ left:8, bottom:8 }, 0, map._container)
  },

  _getQuery: function(layerModel) {
    var query = layerModel.get('query');
    var qw = layerModel.get('query_wrapper');
    if(qw) {
      query = _.template(qw)({ sql: query || ('select * from ' + layerModel.get('table_name')) });
    }
    return query;
  },

  _modelUpdated: function(model) {
    var changed = this.model.changedAttributes();
    if(changed === false) return;
    /*
    changed.tile_style && this.setCartoCSS(this.model.get('tile_style'));
    if ('query' in changed || 'query_wrapper' in changed) {
      this.setSQL(this._getQuery(this.model));
    }
    */

    if ('visible' in changed)
      this.model.get('visible') ? this.show(): this.hide();

    if ('urls' in changed) {
      // REAL HACK
      this.provider.templateUrl = this.model.get('urls').tiles[0];
      this.provider._setReady(true);
      this._reloadTiles();
    }
  }
});

_.extend(LeafletTorqueLayer.prototype, LeafletLayerView.prototype);

module.exports = LeafletTorqueLayer;
