(function () {/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("libs/almond", function(){});

(function(factory){
	if(typeof define != "undefined"){
		define('dcl/mini',[], factory);
	}else if(typeof module != "undefined"){
		module.exports = factory();
	}else{
		dcl = factory();
	}
})(function(){
	"use strict";

	var counter = 0, cname = "constructor", pname = "prototype", empty = {}, mix;

	function dcl(superClass, props){
		var bases = [0], proto, base, ctor, meta, connectionMap,
			output, vector, superClasses, i, j = 0, n;

		if(superClass){
			if(superClass instanceof Array){
				// mixins: C3 MRO
				connectionMap = {};
				superClasses = superClass.slice(0).reverse();
				for(i = superClasses.length - 1; i >= 0; --i){
					base = superClasses[i];
					// pre-process a base
					// 1) add a unique id
					base._uniqueId = base._uniqueId || counter++;
					// 2) build a connection map and the base list
					if((proto = base._meta)){   // intentional assignment
						for(vector = proto.bases, j = vector.length - 1; j > 0; --j){
							n = vector[j]._uniqueId;
							connectionMap[n] = (connectionMap[n] || 0) + 1;
						}
						superClasses[i] = vector.slice(0);
					}else{
						superClasses[i] = [base];
					}
				}
				// build output
				output = {};
				c: while(superClasses.length){
					for(i = 0; i < superClasses.length; ++i){
						vector = superClasses[i];
						base = vector[0];
						n = base._uniqueId;
						if(!connectionMap[n]){
							if(!output[n]){
								bases.push(base);
								output[n] = 1;
							}
							vector.shift();
							if(vector.length){
								--connectionMap[vector[0]._uniqueId];
							}else{
								superClasses.splice(i, 1);
							}
							continue c;
						}
					}
					// error
					dcl._error("cycle", props, superClasses);
				}
				// calculate a base class
				superClass = superClass[0];
				j = bases.length - ((meta = superClass._meta) && superClass === bases[bases.length - (j = meta.bases.length)] ? j : 1) - 1; // intentional assignments
			}else{
				// 1) add a unique id
				superClass._uniqueId = superClass._uniqueId || counter++;
				// 2) single inheritance
				bases = bases.concat((meta = superClass._meta) ? meta.bases : superClass);   // intentional assignment
			}
		}
		// create a base class
		proto = superClass ? dcl.delegate(superClass[pname]) : {};
		// the next line assumes that constructor is actually named "constructor", should be changed if desired
		vector = superClass && (meta = superClass._meta) ? dcl.delegate(meta.weaver) : {constructor: 2};   // intentional assignment

		// create prototype: mix in mixins and props
		for(; j > 0; --j){
			base = bases[j];
			meta = base._meta;
			dcl.mix(proto, meta && meta.ownProps || base[pname]);
			if(meta){
				for(n in (superClasses = meta.weaver)){    // intentional assignment
					vector[n] = (+vector[n] || 0) | superClasses[n];
				}
			}
		}
		for(n in props){
			if(isSuper(meta = props[n])){  // intentional assignment
				vector[n] = +vector[n] || 0;
			}else{
				proto[n] = meta;
			}
		}

		// create stubs with fake constructor
		//
		meta = {bases: bases, ownProps: props, weaver: vector, chains: {}};
		// meta information is coded like that:
		// bases: an array of super classes (bases) and mixins
		// ownProps: a bag of immediate prototype properties for the constructor
		// weaver: a bag of chain instructions (before is 1, after is 2)
		// chains: a bag of chains (ordered arrays)

		bases[0] = {_meta: meta, prototype: proto};
		buildStubs(meta, proto);
		ctor = proto[cname];

		// put in place all decorations and return a constructor
		ctor._meta  = meta;
		ctor[pname] = proto;
		//proto.constructor = ctor; // uncomment if constructor is not named "constructor"
		bases[0] = ctor;

		// each constructor may have two properties on it:
		// _meta: a meta information object as above
		// _uniqueId: a unique number, which is used to id the constructor

		return dcl._postprocess(ctor);    // fully prepared constructor
	}

	// decorators

	function Super(f){ this.around = f; }
	function isSuper(f){ return f && f.spr instanceof Super; }

	// utilities

	function allKeys(o){
		var keys = [];
		for(var name in o){
			keys.push(name);
		}
		return keys;
	}

	(mix = function(a, b){
		for(var n in b){
			a[n] = b[n];
		}
	})(dcl, {
		// piblic API
		mix: mix,
		delegate: function(o){
			return Object.create(o);
		},
		allKeys: allKeys,
		Super: Super,
		superCall: function superCall(f){ return dcl._makeSuper(f); },

		// protected API starts with _ (don't use it!)

		// make a Super marker
		_makeSuper: function makeSuper(advice, S){ var f = function(){}; f.spr = new (S || Super)(advice); return f; },

		// post-processor for a constructor, can be used to add more functionality
		// or augment its behavior
		_postprocess: function(ctor){ return ctor; },   // identity, used to hang on advices

		// error function, augmented by debug.js
		_error: function(msg){ throw Error("dcl: " + msg); },

		// supercall instantiation, augmented by debug.js
		_instantiate: function(advice, previous, node){ var t = advice.spr.around(previous); t.ctr = advice.ctr; return t; },

		// the "buildStubs()" helpers, can be overwritten
		_extractChain: function(bases, name, advice){
			var i = bases.length - 1, chain = [], base, f, around = advice == "around";
			for(; base = bases[i]; --i){
				// next line contains 5 intentional assignments
				if((f = base._meta) ? (f = f.ownProps).hasOwnProperty(name) && (isSuper(f = f[name]) ? (around ? f.spr.around : (f = f.spr[advice])) : around) : around && (f = name == cname ? base : base[pname][name]) && f !== empty[name]){
					f.ctr = base;
					chain.push(f);
				}
			}
			return chain;
		},
		_stubChain: function(chain){ // this is "after" chain
			var l = chain.length, f;
			return !l ? 0 : l == 1 ?
				(f = chain[0], function(){
					f.apply(this, arguments);
				}) :
				function(){
					for(var i = 0; i < l; ++i){
						chain[i].apply(this, arguments);
					}
				};
		},
		_stubSuper: function(chain, name){
			var i = 0, f, p = empty[name];
			for(; f = chain[i]; ++i){
				p = isSuper(f) ? (chain[i] = dcl._instantiate(f, p, name)) : f;
			}
			return name != cname ? p : function(){ p.apply(this, arguments); };
		},
		_stubChainSuper: function(chain, stub, name){
			var i = 0, f, diff, pi = 0;
			for(; f = chain[i]; ++i){
				if(isSuper(f)){
					diff = i - pi;
					chain[i] = dcl._instantiate(f, !diff ? 0 : diff == 1 ? chain[pi] : stub(chain.slice(pi, i)), name);
					pi = i;
				}
			}
			diff = i - pi;
			return !diff ? 0 : diff == 1 && name != cname ? chain[pi] : stub(pi ? chain.slice(pi) : chain);
		},
		_stub: /*generic stub*/ function(id, bases, name, chains){
			var f = chains[name] = dcl._extractChain(bases, name, "around");
			return (id ? dcl._stubChainSuper(f, dcl._stubChain, name) : dcl._stubSuper(f, name)) || function(){};
		}
	});

	function buildStubs(meta, proto){
		var weaver = meta.weaver, bases = meta.bases, chains = meta.chains;
		for(var name in weaver){
			proto[name] = dcl._stub(weaver[name], bases, name, chains);
		}
	}

	return dcl;
});

(function(factory){
	if(typeof define != "undefined"){
		define('dcl/dcl',["./mini"], factory);
	}else if(typeof module != "undefined"){
		module.exports = factory(require("./mini"));
	}else{
		dcl = factory(dcl);
	}
})(function(dcl){
	"use strict";

	function nop(){}

	var Advice = dcl(dcl.Super, {
		//declaredClass: "dcl.Advice",
		constructor: function(){
			this.before = this.around.before;
			this.after  = this.around.after;
			this.around = this.around.around;
		}
	});
	function advise(advice){ return dcl._makeSuper(advice, Advice); }

	function makeAOPStub(before, after, around){
		var beforeChain = before || nop,
			afterChain  = after  || nop,
			aroundChain = around || nop,
			stub = function(){
				var r, thrown;
				// running the before chain
				beforeChain.apply(this, arguments);
				// running the around chain
				try{
					r = aroundChain.apply(this, arguments);
				}catch(e){
					r = e;
					thrown = true;
				}
				// running the after chain
				afterChain.call(this, arguments, r);
				if(thrown){
					throw r;
				}
				return r;
			};
		stub.advices = {before: before, after: after, around: around};
		return stub;
	}

	function chain(id){
		return function(ctor, name){
			var meta = ctor._meta, rule;
			if(meta){
				rule = +meta.weaver[name] || 0;
				if(rule && rule != id){
					dcl._error("set chaining", name, ctor, id, rule);
				}
				meta.weaver[name] = id;
			}
		};
	}

	dcl.mix(dcl, {
		// public API
		Advice: Advice,
		advise: advise,
		// expose helper methods
		before: function(f){ return dcl.advise({before: f}); },
		after:  function(f){ return dcl.advise({after:  f}); },
		around: dcl.superCall,
		// chains
		chainBefore: chain(1),
		chainAfter:  chain(2),
		isInstanceOf: function(o, ctor){
			if(o instanceof ctor){
				return true;
			}
			var t = o.constructor._meta, i;
			if(t){
				for(t = t.bases, i = t.length - 1; i >= 0; --i){
					if(t[i] === ctor){
						return true;
					}
				}
			}
			return false;
		},
		// protected API starts with _ (don't use it!)
		_stub: /*generic stub*/ function(id, bases, name, chains){
			var f = chains[name] = dcl._extractChain(bases, name, "around"),
				b = dcl._extractChain(bases, name, "before").reverse(),
				a = dcl._extractChain(bases, name, "after");
			f = id ? dcl._stubChainSuper(f, id == 1 ? function(f){ return dcl._stubChain(f.reverse()); } : dcl._stubChain, name) : dcl._stubSuper(f, name);
			return !b.length && !a.length ? f || function(){} : makeAOPStub(dcl._stubChain(b), dcl._stubChain(a), f);
		}
	});

	return dcl;
});

define('wcDocker/types',[], function () {

    //stub
    var wcDocker = {};

    /**
     * Enumerated Docking positions.
     * @member module:wcDocker.DOCK
     * @property {String} MODAL="modal" - A floating panel that blocks input until closed
     * @property {String} FLOAT="float" - A floating panel
     * @property {String} TOP="top" - Docks to the top of a target or window
     * @property {String} LEFT="left" - Docks to the left of a target or window
     * @property {String} RIGHT="right" - Docks to the right of a target or window
     * @property {String} BOTTOM="bottom" - Docks to the bottom of a target or window
     * @property {String} STACKED="stacked" - Docks as another tabbed item along with the target
     * @version 3.0.0
     * @const
     */
    wcDocker.DOCK = {
        MODAL: 'modal',
        FLOAT: 'float',
        TOP: 'top',
        LEFT: 'left',
        RIGHT: 'right',
        BOTTOM: 'bottom',
        STACKED: 'stacked'
    };

    /**
     * Enumerated Layout wcDocker.
     * @member module:wcDocker.LAYOUT
     * @property {String} SIMPLE="wcLayoutSimple" - Contains a single div item without management using a {@link module:wcLayoutSimple}, it is up to you to populate it however you wish.
     * @property {String} TABLE="wcLayoutTable" - Manages a table grid layout using {@link module:wcLayoutTable}, this is the default layout used if none is specified.
     * @version 3.0.0
     * @const
     */
    wcDocker.LAYOUT = {
        SIMPLE: 'wcLayoutSimple',
        TABLE: 'wcLayoutTable'
    };

    /**
     * Enumerated Internal events
     * @member module:wcDocker.EVENT
     * @property {String} INIT="panelInit" - When the panel is initialized
     * @property {String} LOADED="dockerLoaded" - When all panels have finished loading
     * @property {String} UPDATED="panelUpdated" - When the panel is updated
     * @property {String} VISIBILITY_CHANGED="panelVisibilityChanged" - When the panel has changed its visibility<br>This event is called with the current visibility state as the first parameter
     * @property {String} BEGIN_DOCK="panelBeginDock" - When the user begins moving any panel from its current docked position
     * @property {String} END_DOCK="panelEndDock" - When the user finishes moving or docking a panel
     * @property {String} GAIN_FOCUS="panelGainFocus" - When the user brings any panel within a tabbed frame into focus
     * @property {String} LOST_FOCUS="panelLostFocus" - When the user leaves focus on any panel within a tabbed frame
     * @property {String} CLOSING="panelClosing" - When the panel is about to be closed, but before it closes. If any event handler returns a falsey value, the close action will be canceled.
     * @property {String} CLOSED="panelClosed" - When the panel is being closed
     * @property {String} PERSISTENT_CLOSED="panelPersistentClosed" - When a persistent panel is being hidden
     * @property {String} PERSISTENT_OPENED="panelPersistentOpened" - When a persistent panel is being shown
     * @property {String} BUTTON="panelButton" - When a custom button is clicked, See [wcPanel.addButton]{@link module:wcPanel~addButton}
     * @property {String} ATTACHED="panelAttached" - When the panel has moved from floating to a docked position
     * @property {String} DETACHED="panelDetached" - When the panel has moved from a docked position to floating
     * @property {String} MOVE_STARTED="panelMoveStarted" - When the user has started moving the panel (top-left coordinates changed)<br>This event is called with an object of the current {x, y} position as the first parameter
     * @property {String} MOVE_ENDED="panelMoveEnded" - When the user has finished moving the panel<br>This event is called with an object of the current {x, y} position as the first parameter
     * @property {String} MOVED="panelMoved" - When the top-left coordinates of the panel has changed<br>This event is called with an object of the current {x, y} position as the first parameter
     * @property {String} RESIZE_STARTED="panelResizeStarted" - When the user has started resizing the panel (width or height changed)<br>This event is called with an object of the current {width, height} size as the first parameter
     * @property {String} RESIZE_ENDED="panelResizeEnded" - When the user has finished resizing the panel<br>This event is called with an object of the current {width, height} size as the first parameter
     * @property {String} RESIZED="panelResized" - When the panels width or height has changed<br>This event is called with an object of the current {width, height} size as the first parameter
     * @property {String} ORDER_CHANGED="panelOrderChanged" - This only happens with floating windows when the order of the windows have changed.
     * @property {String} SCROLLED="panelScrolled" - When the contents of the panel has been scrolled
     * @property {String} SAVE_LAYOUT="layoutSave" - When the layout is being saved, See [wcDocker.save]{@link module:wcDocker#save}
     * @property {String} RESTORE_LAYOUT="layoutRestore" - When the layout is being restored, See [wcDocker.restore]{@link module:wcDocker#restore}
     * @property {String} CUSTOM_TAB_CHANGED="customTabChanged" - When the current tab on a custom tab widget associated with this panel has changed, See {@link module:wcTabFrame}
     * @property {String} CUSTOM_TAB_CLOSED="customTabClosed" - When a tab has been closed on a custom tab widget associated with this panel, See {@link module:wcTabFrame}
     * @version 3.0.0
     * @const
     */
    wcDocker.EVENT = {
        INIT: 'panelInit',
        LOADED: 'dockerLoaded',
        UPDATED: 'panelUpdated',
        VISIBILITY_CHANGED: 'panelVisibilityChanged',
        BEGIN_DOCK: 'panelBeginDock',
        END_DOCK: 'panelEndDock',
        GAIN_FOCUS: 'panelGainFocus',
        LOST_FOCUS: 'panelLostFocus',
        CLOSING: 'panelClosing',
        CLOSED: 'panelClosed',
        PERSISTENT_CLOSED: 'panelPersistentClosed',
        PERSISTENT_OPENED: 'panelPersistentOpened',
        BUTTON: 'panelButton',
        ATTACHED: 'panelAttached',
        DETACHED: 'panelDetached',
        MOVE_STARTED: 'panelMoveStarted',
        MOVE_ENDED: 'panelMoveEnded',
        MOVED: 'panelMoved',
        RESIZE_STARTED: 'panelResizeStarted',
        RESIZE_ENDED: 'panelResizeEnded',
        RESIZED: 'panelResized',
        ORDER_CHANGED: 'panelOrderChanged',
        SCROLLED: 'panelScrolled',
        SAVE_LAYOUT: 'layoutSave',
        RESTORE_LAYOUT: 'layoutRestore',
        CUSTOM_TAB_CHANGED: 'customTabChanged',
        CUSTOM_TAB_CLOSED: 'customTabClosed'
    };

    /**
     * The name of the placeholder panel.
     * @private
     * @memberOf module:wcDocker
     * @constant {String} module:wcDocker.PANEL_PLACEHOLDER
     */
    wcDocker.PANEL_PLACEHOLDER = '__wcDockerPlaceholderPanel';

    /**
     * Used when [adding]{@link module:wcDocker#addPanel} or [moving]{@link module:wcDocker#movePanel} a panel to designate the target location as collapsed.<br>
     * Must be used with [docking]{@link module:wcDocker.DOCK} positions LEFT, RIGHT, or BOTTOM only.
     * @memberOf module:wcDocker
     * @constant {String} module:wcDocker.COLLAPSED
     */
    wcDocker.COLLAPSED = '__wcDockerCollapsedPanel';

    /**
     * Used for the splitter bar orientation.
     * @member module:wcDocker.ORIENTATION
     * @property {Boolean} VERTICAL=false - Top and Bottom panes
     * @property {Boolean} HORIZONTAL=true - Left and Right panes
     * @version 3.0.0
     * @const
     */
    wcDocker.ORIENTATION = {
        VERTICAL: false,
        HORIZONTAL: true
    };
    /**
     * Used to determine the position of tabbed widgets for stacked panels.<br>
     * <b>Note:</b> Not supported on IE8 or below.
     * @member module:wcDocker.TAB
     * @property {String} TOP="top" - The default, puts tabs at the top of the frame
     * @property {String} LEFT="left" - Puts tabs on the left side of the frame
     * @property {String} RIGHT="right" - Puts tabs on the right side of the frame
     * @property {String} BOTTOM="bottom" - Puts tabs on the bottom of the frame
     * @version 3.0.0
     * @const
     */
    wcDocker.TAB = {
        TOP: 'top',
        LEFT: 'left',
        RIGHT: 'right',
        BOTTOM: 'bottom'
    };

    return wcDocker;

});
/** @module wcBase */
define('wcDocker/base',[
    "dcl/dcl"
], function(dcl) {
    /**
     * Base class for all docker classes
     * @class module:wcBase
     */
    return dcl(null, {
        /**
         * Returns this or the docker's options
         * @TODO: better looking through the parents?
         * @function module:wcBase#getOptions
         * @returns {Object|null}
         */
        getOptions: function() {
            return this._options || this.docker()._options || {};
        },

        /**
         * Return an option found in this or in the docker.
         * @function module:wcBase#option
         * @param name
         * @param _default {Object|null}
         * @returns {Object|null}
         */
        option: function(name,_default) {
            return this.getOptions()[name] || _default;
        },

        /**
         * Class eq function
         * @function module:wcBase#instanceOf
         * @param {string} what
         * @param {object} [who]
         * @returns {boolean}
         */
        instanceOf: function(what, who) {
            who = who || this;
            return !!(who && (who.declaredClass.indexOf(what)!=-1));
        },

        /**
         * Retrieves the main [docker]{@link module:wcDocker} instance.
         * @function module:wcBase#docker
         * @returns {module:wcDocker} - The top level docker object.
         */
        docker: function(startNode) {
            var parent = startNode || this._parent;
            while (parent && !(parent.instanceOf('wcDocker'))) {
                parent = parent._parent;
            }
            return parent;
        },

        /**
         * Return a module (dcl) by class name.
         * @function module:wcBase#__getClass
         * @param name {string} the class name, for instance "wcPanel", "wcSplitter" and so forth. Please see in wcDocker#defaultClasses for available class names.
         * @returns {object} the dcl module found in options
         * @private
         */
        __getClass: function(name) {
            return this.getOptions()[name+'Class'];
        }
    });
});

/** @module wcPanel */
define('wcDocker/panel',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcPanel
     * The public interface for the docking panel, it contains a number of convenience
     * functions and layout that manages the contents of the panel.
     */
    var Module = dcl(base, {
        declaredClass: 'wcPanel',

        /**
         * @memberOf module:wcPanel
         * <b><i>PRIVATE</i> - Use [wcDocker.addPanel]{@link module:wcDocker#addPanel}, [wcDocker.removePanel]{@link module:wcDocker#removePanel}, and
         * [wcDocker.movePanel]{@link module:wcDocker#movePanel} to manage panels, <u>this should never be constructed directly
         * by the user.</u></b>
         * @param {module:wcBase} parent - The parent.
         * @param {String} type - The name identifier for the panel.
         * @param {module:wcPanel~options} [options] - An options object passed from registration of the panel.
         */
        constructor: function (parent, type, options) {
            /**
             * An options object for the [panel]{@link module:wcPanel} constructor.
             * @typedef module:wcPanel~options
             * @property {String} [icon] - A CSS classname that represents the icon that should display on this panel's tab widget.
             * @property {String} [faicon] - An icon name using the [Font-Awesome]{@link http://fortawesome.github.io/Font-Awesome/} library.
             * @property {String|Boolean} [title] - A custom title to display for this panel, if false, title bar will not be shown.
             * @property {Number|String} [detachToWidth=600] - Determines the new width when the panel is detached (0 = Don't change). Can be a pixel value, or a string with a 'px' or '%' suffix.
             * @property {Number|String} [detachToHeight=400] - Determines the new height when the panel is detached (0 = Don't change).  Can be a pixel value, or a string with a 'px' or '%' suffix.
             */

            /**
             * The outer container element of the panel.
             * @member {external:jQuery~Object}
             */
            this.$container = null;
            this._parent = parent;
            this.$icon = null;
            this.$title = null;
            this.$titleText = null;
            this.$loading = null;

            this._panelObject = null;
            this._initialized = false;
            this._collapseDirection = undefined;

            this._type = type;
            this._title = type;
            this._titleVisible = true;

            this._options = options;

            this._layout = null;

            this._buttonList = [];

            this._actualPos = {
                x: 0.5,
                y: 0.5
            };

            this._actualSize = {
                x: 0,
                y: 0
            };

            this._resizeData = {
                time: -1,
                timeout: false,
                delta: 150
            };

            this._pos = {
                x: 0.5,
                y: 0.5
            };

            this._moveData = {
                time: -1,
                timeout: false,
                delta: 150
            };

            this._size = {
                x: -1,
                y: -1
            };

            this._minSize = {
                x: 100,
                y: 100
            };

            this._maxSize = {
                x: Infinity,
                y: Infinity
            };

            this._scroll = {
                x: 0,
                y: 0
            };

            this._scrollable = {
                x: true,
                y: true
            };

            this._collapsible = true;
            this._overflowVisible = false;
            this._moveable = true;
            this._detachable = true;
            this._closeable = true;
            this._resizeVisible = true;
            this._isVisible = false;

            this._events = {};

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Gets, or Sets the title for this panel.
         * Titles appear in the tab widget associated with the panel.
         * @function module:wcPanel#title
         * @param {String|Boolean} title - If supplied, sets the new title (this can be html text). If false, the title bar will be removed.
         * @returns {String|Boolean} - The current title.
         */
        title: function (title) {
            if (typeof title !== 'undefined') {
                if (title === false) {
                    this._titleVisible = false;
                    this.$titleText.html(this._type);
                } else {
                    this._title = title;
                    this.$titleText.html(title);
                }

                if (this.$icon) {
                    this.$titleText.prepend(this.$icon);
                }

                if (this._parent && this._parent.instanceOf('wcFrame')) {
                    this._parent.__updateTabs();
                }
            }

            return this._title;
        },

        /**
         * Retrieves the registration info of the panel as declared from
         * [wcDocker.registerPanelType]{@link module:wcDocker#registerPanelType};
         * @function module:wcPanel#info
         * @returns {module:wcDocker~registerOptions} - Registered options of the panel type.
         * @see [wcDocker.panelTypeInfo]{@link module:wcDocker#panelTypeInfo}.
         */
        info: function () {
            return this.docker().panelTypeInfo(this._type);
        },

        /**
         * Retrieves the layout instance.
         * @function module:wcPanel#layout
         * @returns {module:wcLayoutSimple|wcLayoutTable} - The layout instance.
         */
        layout: function () {
            return this._layout;
        },

        /**
         * Brings this panel into focus. If it is floating, it will be moved to the front of all other panels.
         * @function module:wcPanel#focus
         * @param {Boolean} [flash] - If true, in addition to bringing the panel into focus, it will also flash for the user.
         */
        focus: function (flash) {
            var docker = this.docker();
            if (docker) {
                docker.__focus(this._parent, flash);
                for (var i = 0; i < this._parent._panelList.length; ++i) {
                    if (this._parent._panelList[i] === this && this._parent._curTab !== i) {
                        this._parent.panel(i);
                        break;
                    }
                }
            }
        },

        /**
         * @callback wcPanel~CollapseDirection
         * @see module:wcPanel#collapseDirection
         * @param {module:wcDocker~Bounds} bounds - The bounds of this panel relative to the wcDocker container.
         * @returns {module:wcDocker.DOCK} - A collapse direction to use, must only be LEFT, RIGHT, or BOTTOM
         */

        /**
         * Gets, or Sets the collapse direction for this panel.
         * @function module:wcPanel#collapseDirection
         * @param {module:wcPanel~CollapseDirection|wcDocker.DOCK} direction - The collapse direction to use for this panel.<br>If this value is omitted, the default collapse direction will be used.
         */
        collapseDirection: function (direction) {
            this._collapseDirection = direction;
        },

        /**
         * Retrieves whether this panel can be seen by the user.
         * @function module:wcPanel#isVisible
         * @returns {Boolean} - Visibility state.
         */
        isVisible: function () {
            return this._isVisible;
        },

        /**
         * Retrieves whether this panel is floating.
         * @function module:wcPanel#isFloating
         * @returns {Boolean}
         */
        isFloating: function () {
            if (this._parent && this._parent.instanceOf('wcFrame')) {
                return this._parent._isFloating;
            }
            return false;
        },

        /**
         * Retrieves whether this panel is in focus.
         * @function module:wcPanel#isInFocus
         * @return {Boolean}
         */
        isInFocus: function () {
            var docker = this.docker();
            if (docker && this._parent && this._parent.instanceOf('wcFrame')) {
                return this._parent === docker._focusFrame;
            }
            return false;
        },

        /**
         * Creates a new custom button that will appear in the title bar when the panel is active.
         * @function module:wcPanel#addButton
         * @param {String} name               - The name of the button, to identify it later.
         * @param {String} className          - A CSS class name to apply to the button.
         * @param {String} text               - Text to apply to the button.
         * @param {String} tip                - Tooltip text for the user.
         * @param {Boolean} [isTogglable]     - If true, will make the button toggle on and off per click.
         * @param {String} [toggleClassName]  - If this button is toggleable, you can designate an optional CSS class name that will replace the original class name.
         */
        addButton: function (name, className, text, tip, isTogglable, toggleClassName) {
            this._buttonList.push({
                name: name,
                className: className,
                toggleClassName: toggleClassName,
                text: text,
                tip: tip,
                isTogglable: isTogglable,
                isToggled: false
            });

            if (this._parent && this._parent.instanceOf('wcFrame')) {
                this._parent.__update();
            }
        },

        /**
         * Removes a custom button from the panel.
         * @function module:wcPanel#removeButton
         * @param {String} name - The name identifier for the button to remove.
         * @returns {Boolean} - Success or failure.
         */
        removeButton: function (name) {
            for (var i = 0; i < this._buttonList.length; ++i) {
                if (this._buttonList[i].name === name) {
                    this._buttonList.splice(i, 1);
                    if (this._parent && this._parent.instanceOf('wcFrame')) {
                        this._parent.__onTabChange();
                    }

                    if (this._parent && this._parent.instanceOf('wcFrame')) {
                        this._parent.__update();
                    }

                    return true;
                }
            }
            return false;
        },

        /**
         * Gets, or Sets the current toggle state of a custom button that was
         * added using [wcPanel.addButton]{@link module:wcPanel#addButton}.
         * @function module:wcPanel#buttonState
         * @param {String} name - The name identifier of the button.
         * @param {Boolean} [toggleState] - If supplied, will assign a new toggle state to the button.
         * @returns {Boolean} - The current toggle state of the button.
         */
        buttonState: function (name, toggleState) {
            for (var i = 0; i < this._buttonList.length; ++i) {
                if (this._buttonList[i].name === name) {
                    if (typeof toggleState !== 'undefined') {
                        this._buttonList[i].isToggled = toggleState;
                        if (this._parent && this._parent.instanceOf('wcFrame')) {
                            this._parent.__onTabChange();
                        }
                    }

                    if (this._parent && this._parent.instanceOf('wcFrame')) {
                        this._parent.__update();
                    }

                    return this._buttonList[i].isToggled;
                }
            }
            return false;
        },

        /**
         * Gets, or Sets the default position of the panel if it is floating. <b>Warning: after the panel has been initialized, this value no longer reflects the current position of the panel.</b>
         * @function module:wcPanel#initPos
         * @param {Number|String} [x] - If supplied, sets the horizontal position of the floating panel. Can be a percentage position, or a string with a 'px' or '%' suffix.
         * @param {Number|String} [y] - If supplied, sets the vertical position of the floating panel. Can be a percentage position, or a string with a 'px' or '%' suffix.
         * @returns {module:wcDocker~Coordinate} - The current default position of the panel.
         */
        initPos: function (x, y) {
            if (typeof x !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._pos.x = docker.__stringToPercent(x, docker.$container.width());
                } else {
                    this._pos.x = x;
                }
            }
            if (typeof y !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._pos.y = docker.__stringToPercent(y, docker.$container.height());
                } else {
                    this._pos.y = y;
                }
            }

            return {x: this._pos.x, y: this._pos.y};
        },

        /**
         * Gets, or Sets the desired size of the panel. <b>Warning: after the panel has been initialized, this value no longer reflects the current size of the panel.</b>
         * @function module:wcPanel#initSize
         * @param {Number|String} [x] - If supplied, sets the desired initial horizontal size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @param {Number|String} [y] - If supplied, sets the desired initial vertical size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @returns {module:wcDocker~Size} - The current initial size of the panel.
         */
        initSize: function (x, y) {
            if (typeof x !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._size.x = docker.__stringToPixel(x, docker.$container.width());
                } else {
                    this._size.x = x;
                }
            }
            if (typeof y !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._size.y = docker.__stringToPixel(y, docker.$container.height());
                } else {
                    this._size.y = y;
                }
            }
            return {x: this._size.x, y: this._size.y};
        },

        /**
         * Gets, or Sets the minimum size constraint of the panel.
         * @function module:wcPanel#minSize
         * @param {Number|String} [x] - If supplied, sets the desired minimum horizontal size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @param {Number|String} [y] - If supplied, sets the desired minimum vertical size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @returns {module:wcDocker~Size} - The current minimum size.
         */
        minSize: function (x, y) {
            if (typeof x !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._minSize.x = docker.__stringToPixel(x, docker.$container.width());
                } else {
                    this._minSize.x = x;
                }
            }
            if (typeof y !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._minSize.y = docker.__stringToPixel(y, docker.$container.height());
                } else {
                    this._minSize.y = y;
                }
            }
            return {x: this._minSize.x, y: this._minSize.y};
        },

        /**
         * Gets, or Sets the maximum size constraint of the panel.
         * @function module:wcPanel#maxSize
         * @param {Number|String} [x] - If supplied, sets the desired maximum horizontal size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @param {Number|String} [y] - If supplied, sets the desired maximum vertical size of the panel. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @returns {module:wcDocker~Size} - The current maximum size.
         */
        maxSize: function (x, y) {
            if (typeof x !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._maxSize.x = docker.__stringToPixel(x, docker.$container.width());
                } else {
                    this._maxSize.x = x;
                }
            }
            if (typeof y !== 'undefined') {
                var docker = this.docker();
                if (docker) {
                    this._maxSize.y = docker.__stringToPixel(y, docker.$container.height());
                } else {
                    this._maxSize.y = y;
                }
            }
            return {x: this._maxSize.x, y: this._maxSize.y};
        },

        /**
         * Retrieves the width of the panel contents.
         * @function module:wcPanel#width
         * @returns {Number} - Panel width.
         */
        width: function () {
            if (this.$container) {
                return this.$container.width();
            }
            return 0.0;
        },

        /**
         * Retrieves the height of the panel contents.
         * @function module:wcPanel#height
         * @returns {Number} - Panel height.
         */
        height: function () {
            if (this.$container) {
                return this.$container.height();
            }
            return 0.0;
        },

        /**
         * Sets the icon for the panel, shown in the panels tab widget. Must be a css class name that contains the icon.
         * @function module:wcPanel#icon
         * @param {String} icon - The icon class name.
         */
        icon: function (icon) {
            if (!this.$icon) {
                this.$icon = $('<div>');
                this.$titleText.prepend(this.$icon);
            }

            this.$icon.removeClass();
            this.$icon.addClass('wcTabIcon ' + icon);

            if (this._parent && this._parent.instanceOf('wcFrame')) {
                this._parent.__updateTabs();
            }
        },

        /**
         * Sets the icon for the panel, shown in the panels tab widget,
         * to an icon defined from the [Font-Awesome]{@link http://fortawesome.github.io/Font-Awesome/} library.
         * @function module:wcPanel#faicon
         * @param {String} icon - The font-awesome icon name.
         */
        faicon: function (icon) {
            if (!this.$icon) {
                this.$icon = $('<div>');
                this.$titleText.prepend(this.$icon);
            }

            this.$icon.removeClass();
            this.$icon.addClass('wcTabIcon fa fa-fw fa-' + icon);

            if (this._parent && this._parent.instanceOf('wcFrame')) {
                this._parent.__updateTabs();
            }
        },

        /**
         * Gets, or Sets whether the window is scrollable.
         * @function module:wcPanel#scrollable
         * @param {Boolean} [x] - If supplied, assigns whether the window is scrollable in the horizontal direction.
         * @param {Boolean} [y] - If supplied, assigns whether the window is scrollable in the vertical direction.
         * @returns {module:wcDocker~Scrollable} - The current scrollable status.
         */
        scrollable: function (x, y) {
            if (typeof x !== 'undefined') {
                this._scrollable.x = x ? true : false;
                this._scrollable.y = y ? true : false;
            }

            return {x: this._scrollable.x, y: this._scrollable.y};
        },

        /**
         * Gets, or Sets the scroll position of the panel's contents if it is scrollable; See [wcPanel.scrollable]{@link module:wcPanel#scrollable}).
         * @function module:wcPanel#scroll
         * @param {Number} [x]        - If supplied, sets the scroll horizontal position of the panel.
         * @param {Number} [y]        - If supplied, sets the scroll vertical position of the panel.
         * @param {Number} [duration] - If supplied, will animate the scroll movement with the supplied duration (in milliseconds).
         * @returns {module:wcDocker~Coordinate} The current scroll position.
         */
        scroll: function (x, y, duration) {
            if (!this.$container) {
                return {x: 0, y: 0};
            }

            if (typeof x !== 'undefined') {
                if (duration) {
                    this.$container.parent().stop().animate({
                        scrollLeft: x,
                        scrollTop: y
                    }, duration);
                } else {
                    this.$container.parent().scrollLeft(x);
                    this.$container.parent().scrollTop(y);
                }
            }

            return {
                x: this.$container.parent().scrollLeft(),
                y: this.$container.parent().scrollTop()
            };
        },

        /**
         * Gets, or Sets whether this panel can be collapsed to the side or bottom.<br>
         * This only works if the collapse feature is enabled {@link module:wcDocker~Options}.
         * @function module:wcPanel#collapsible
         * @param {Boolean} [enabled] - If supplied, assigns whether collapsing is enabled.
         * @returns {Boolean} - The current collapsible enabled state.
         */
        collapsible: function (enabled) {
            if (typeof enabled !== 'undefined') {
                this._collapsible = enabled ? true : false;
            }

            return this._collapsible;
        },

        /**
         * Gets, or Sets whether overflow on this panel is visible.
         * Use this if a child element within this panel is intended to 'popup' and be visible outside of its parent area.
         * @function module:wcPanel#overflowVisible
         * @param {Boolean} [visible] - If supplied, assigns whether overflow is visible.
         * @returns {Boolean} - The current overflow visibility.
         */
        overflowVisible: function (visible) {
            if (typeof visible !== 'undefined') {
                this._overflowVisible = visible ? true : false;
            }

            return this._overflowVisible;
        },

        /**
         * Gets, or Sets whether the contents of the panel are visible on resize.
         * Use this if the panel has extremely expensive contents which take a long time to resize.
         * @function module:wcPanel#resizeVisible
         * @param {Boolean} [visible] - If supplied, assigns whether panel contents are visible during resize.
         * @returns {Boolean} - The current resize visibility.
         */
        resizeVisible: function (visible) {
            if (typeof visible !== 'undefined') {
                this._resizeVisible = visible ? true : false;
            }

            return this._resizeVisible;
        },

        /**
         * Sets, or Gets the moveable status of the window.
         * Note: Other panels can not dock beside a non-moving panel as doing so could cause it to move.
         * @function module:wcPanel#moveable
         * @param {Boolean} [enabled] - If supplied, assigns whether this panel can be moved.
         * @returns {Boolean} - Whether the panel is moveable.
         */
        moveable: function (enabled) {
            if (typeof enabled !== 'undefined') {
                this._moveable = enabled ? true : false;

                this.$title.toggleClass('wcNotMoveable', !this._moveable);
            }

            return this._moveable;
        },

        /**
         * Sets, or Gets whether this panel can be detached into a floating panel.
         * @function module:wcPanel#detachable
         * @param {Boolean} [enabled] - If supplied, assigns whether this panel can be detached.
         * @returns {Boolean} - Whether this panel can detach.
         */
        detachable: function(enabled) {
            if (typeof enabled !== 'undefined') {
                this._detachable = enabled ? true: false;
            }

            return this._detachable;
        },

        /**
         * Gets, or Sets whether this dock window can be closed by the user.
         * Note: The panel can still be closed programmatically.
         * @function module:wcPanel#closeable
         * @param {Boolean} [enabled] - If supplied, toggles whether it can be closed.
         * @returns {Boolean} the current closeable status.
         */
        closeable: function (enabled) {
            if (typeof enabled !== 'undefined') {
                this._closeable = enabled ? true : false;
                if (this._parent) {
                    this._parent.__update();
                }
            }

            return this._closeable;
        },

        /**
         * Forces the window to close.
         * @function module:wcPanel#close
         */
        close: function () {
            var docker = this.docker();
            if (docker) {
                docker.__closePanel(this);
            }
        },

        /**
         * Shows the loading screen.
         * @function module:wcPanel#startLoading
         * @param {String} [label] - An optional label to display.
         * @param {Number} [opacity=0.4] - If supplied, assigns a custom opacity value to the loading screen.
         * @param {Number} [textOpacity=1] - If supplied, assigns a custom opacity value to the loading icon and text displayed.
         */
        startLoading: function (label, opacity, textOpacity) {
            if (!this.$loading) {
                this.$loading = $('<div class="wcLoadingContainer"></div>');
                this.$container.append(this.$loading);

                var $background = $('<div class="wcLoadingBackground"></div>');
                if (typeof opacity !== 'number') {
                    opacity = 0.4;
                }

                this.$loading.append($background);

                var $icon = $('<div class="wcLoadingIconContainer"><i class="wcLoadingIcon ' + this.docker()._options.loadingClass + '"></i></div>');
                this.$loading.append($icon);

                if (label) {
                    var $label = $('<span class="wcLoadingLabel">' + label + '</span>');
                    this.$loading.append($label);
                }

                if (typeof textOpacity !== 'number') {
                    textOpacity = 1;
                }

                // Override opacity values if the global loading screen is active.
                if (this.docker().$loading) {
                    opacity = 0;
                    textOpacity = 0;
                }

                $background.css('opacity', opacity);
                $icon.css('opacity', textOpacity);

                if ($label) {
                    $label.css('opacity', textOpacity);
                }
            }
        },

        /**
         * Hides the loading screen.
         * @function module:wcPanel#finishLoading
         * @param {Number} [fadeDuration=0] - If supplied, assigns a fade out duration for the loading screen.
         */
        finishLoading: function (fadeDuration) {
            if (this.$loading) {
                if (fadeDuration > 0) {
                    var self = this;
                    this.$loading.fadeOut(fadeDuration, function () {
                        self.$loading.remove();
                        self.$loading = null;
                        self.docker().__testLoadFinished();
                    });
                } else {
                    this.$loading.remove();
                    this.$loading = null;
                    this.docker().__testLoadFinished();
                }

            }
        },

        /**
         * Registers an [event]{@link module:wcDocker.EVENT} associated with this panel.
         * @function module:wcPanel#on
         * @param {String} eventType - The event type, can be a custom event string or a [predefined event]{@link module:wcDocker.EVENT}.
         * @param {module:wcDocker#onEvent} handler - An event handler function to be called when the event is fired.
         * @returns {Boolean} - Event registration success or failure.
         */
        on: function (eventType, handler) {
            if (!eventType) {
                return false;
            }

            if (!this._events[eventType]) {
                this._events[eventType] = [];
            }

            if (this._events[eventType].indexOf(handler) !== -1) {
                return false;
            }

            this._events[eventType].push(handler);
            return true;
        },

        /**
         * Unregisters an [event]{@link module:wcDocker.EVENT} associated with this panel.
         * @function module:wcPanel#off
         * @param {module:wcDocker.EVENT} eventType - The event type, can be a custom event string or a [predefined event]{@link module:wcDocker.EVENT}.
         * @param {module:wcDocker~event:onEvent} [handler] - The handler function registered with the event. If omitted, all events registered to the event type are unregistered.
         */
        off: function (eventType, handler) {
            if (typeof eventType === 'undefined') {
                this._events = {};
                return;
            } else {
                if (this._events[eventType]) {
                    if (typeof handler === 'undefined') {
                        this._events[eventType] = [];
                    } else {
                        for (var i = 0; i < this._events[eventType].length; ++i) {
                            if (this._events[eventType][i] === handler) {
                                this._events[eventType].splice(i, 1);
                                break;
                            }
                        }
                    }
                }
            }
        },

        /**
         * Triggers an [event]{@link module:wcDocker.EVENT} of a given type to all panels, including itself.
         * @function module:wcPanel#trigger
         * @param {module:wcDocker.EVENT} eventType - The event type, can be a custom event string or a [predefined event]{@link module:wcDocker.EVENT}.
         * @param {Object} [data] - A custom data object to pass into all handlers.
         * @returns {Object[]} results - Returns an array with all results returned by event handlers.
         */
        trigger: function (eventType, data) {
            var docker = this.docker();
            if (docker) {
                return docker.trigger(eventType, data);
            }
            return [];
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            var layoutClass = (this._options && this._options.layout) || 'wcLayoutTable';
            this._layout = new (this.docker().__getClass(layoutClass))(this.$container, this);
            this.$title = $('<div class="wcPanelTab">');
            this.$titleText = $('<div>' + this._title + '</div>');
            this.$title.append(this.$titleText);

            if (this._options.hasOwnProperty('title')) {
                this.title(this._options.title);
            }

            if (this._options.icon) {
                this.icon(this._options.icon);
            }
            if (this._options.faicon) {
                this.faicon(this._options.faicon);
            }
        },

        // Updates the size of the layout.
        __update: function () {
            var docker = this.docker();
            if (!docker) return;

            this._layout.__update();
            if (!this.$container) {
                return;
            }

            if (this._resizeVisible) {
                this._parent.$frame.removeClass('wcHideOnResize');
            } else {
                this._parent.$frame.addClass('wcHideOnResize');
            }

            if (!this._initialized) {
                this._initialized = true;
                var self = this;
                setTimeout(function () {
                    self.__trigger(wcDocker.EVENT.INIT);

                    docker.__testLoadFinished();
                }, 0);
            } else {
                this.__trigger(wcDocker.EVENT.UPDATED);
            }

            var width = this.$container.width();
            var height = this.$container.height();
            if (this._actualSize.x !== width || this._actualSize.y !== height) {
                this._resizeData.time = new Date();
                if (!this._resizeData.timeout) {
                    this._resizeData.timeout = true;
                    setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
                    this.__trigger(wcDocker.EVENT.RESIZE_STARTED, {width: this._actualSize.x, height: this._actualSize.y});
                }

                this._actualSize.x = width;
                this._actualSize.y = height;
                this.__trigger(wcDocker.EVENT.RESIZED, {width: this._actualSize.x, height: this._actualSize.y});
            }

            var offset = this.$container.offset();
            if (this._actualPos.x !== offset.left || this._actualPos.y !== offset.top) {
                this._moveData.time = new Date();
                if (!this._moveData.timeout) {
                    this._moveData.timeout = true;
                    setTimeout(this.__moveEnd.bind(this), this._moveData.delta);
                    this.__trigger(wcDocker.EVENT.MOVE_STARTED, {x: this._actualPos.x, y: this._actualPos.y});
                }

                this._actualPos.x = offset.left;
                this._actualPos.y = offset.top;
                this.__trigger(wcDocker.EVENT.MOVED, {x: this._actualPos.x, y: this._actualPos.y});
            }
        },

        __resizeEnd: function () {
            if (new Date() - this._resizeData.time < this._resizeData.delta) {
                setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
            } else {
                this._resizeData.timeout = false;
                this.__trigger(wcDocker.EVENT.RESIZE_ENDED, {width: this._actualSize.x, height: this._actualSize.y});
            }
        },

        __moveEnd: function () {
            if (new Date() - this._moveData.time < this._moveData.delta) {
                setTimeout(this.__moveEnd.bind(this), this._moveData.delta);
            } else {
                this._moveData.timeout = false;
                this.__trigger(wcDocker.EVENT.MOVE_ENDED, {x: this._actualPos.x, y: this._actualPos.y});
            }
        },

        __isVisible: function (inView) {
            if (this._isVisible !== inView) {
                this._isVisible = inView;

                this.__trigger(wcDocker.EVENT.VISIBILITY_CHANGED, this._isVisible);
            }
        },

        // Saves the current panel configuration into a meta
        // object that can be used later to restore it.
        __save: function () {
            var data = {};
            data.type = 'wcPanel';
            data.panelType = this._type;
            // data.title = this._title;
            data.size = {
                x: this._size.x,
                y: this._size.y
            };
            // data.minSize = {
            //   x: this._minSize.x,
            //   y: this._minSize.y,
            // };
            // data.maxSize = {
            //   x: this._maxSize.x,
            //   y: this._maxSize.y,
            // };
            // data.scrollable = {
            //   x: this._scrollable.x,
            //   y: this._scrollable.y,
            // };
            // data.moveable = this._moveable;
            // data.closeable = this._closeable;
            // data.resizeVisible = this.resizeVisible();
            data.customData = {};
            this.__trigger(wcDocker.EVENT.SAVE_LAYOUT, data.customData);
            return data;
        },

        // Restores a previously saved configuration.
        __restore: function (data, docker) {
            // this._title = data.title;
            if (data.size) {
                this._size.x = data.size.x;
                this._size.y = data.size.y;
            }
            // this._minSize.x = data.minSize.x;
            // this._minSize.y = data.minSize.y;
            // this._maxSize.x = data.maxSize.x;
            // this._maxSize.y = data.maxSize.y;
            // this._scrollable.x = data.scrollable.x;
            // this._scrollable.y = data.scrollable.y;
            // this._moveable = data.moveable;
            // this._closeable = data.closeable;
            // this.resizeVisible(data.resizeVisible);
            this.__trigger(wcDocker.EVENT.RESTORE_LAYOUT, data.customData);
        },

        // Triggers an event of a given type onto this current panel.
        // Params:
        //    eventType     The event to trigger.
        //    data          A custom data object to pass into all handlers.
        __trigger: function (eventType, data) {
            if (!eventType) {
                return false;
            }

            var results = [];

            if (this._events[eventType]) {
                var events = this._events[eventType].slice(0);
                for (var i = 0; i < events.length; ++i) {
                    results.push(events[i].call(this, data));
                }
            }

            return results;
        },

        // Retrieves the bounding rect for this widget.
        __rect: function () {
            var offset = this.$container.offset();
            var width = this.$container.width();
            var height = this.$container.height();

            return {
                x: offset.left,
                y: offset.top,
                w: width,
                h: height
            };
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;

            if (this.$container) {
                this._layout.__container(this.$container);
                if (this.$loading) {
                    this.$container.append(this.$loading);
                }
            } else {
                this._layout.__container(null);
                this.finishLoading();
            }
            return this.$container;
        },
        // Destroys this panel.
        __destroy: function () {
            this._panelObject = null;
            this.off();

            this.__container(null);
            this._parent = null;
        }
    });

    // window['wcPanel'] = Module;
    return Module;
});

/** @module wcGhost **/
define('wcDocker/ghost',[
    "dcl/dcl",
    "./types"
], function (dcl, wcDocker) {

    /**
     * @class module:wcGhost
     * A ghost object that follows the mouse around during dock movement.
     */
    var Module = dcl(null, {
        declaredClass: 'wcGhost',
        
        /**
         * @memberOf module:wcGhost
         * @param {module:wcDocker~Rect} rect - A rectangle area to begin the ghost highlighting.
         * @param {module:wcDocker~Coordinate} mouse - The mouse position.
         * @param {module:wcDocker} docker - The docker object.
         */
        constructor: function (rect, mouse, docker) {
            this.$ghost = null;
            this._rect;
            this._anchorMouse = false;
            this._anchor = null;
            this._docker = docker;

            this._outer = docker.__findInner();
            if (this._outer && this._outer.instanceOf('wcSplitter')) {
                this._inner = this._outer.right();
            }

            this.__init(rect, mouse);
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Updates the ghost based on the given screen position.
         * @function module:wcGhost#update
         * @param {module:wcDocker~Coordinate} position - The mouse position.
         * @param {Boolean} [disableFloating] - If true, the ghost will not float.
         */
        update: function (position, disableFloating) {
            this.__move(position);

            for (var i = 0; i < this._docker._floatingList.length; ++i) {
                var rect = this._docker._floatingList[i].__rect();
                if (position.x > rect.x && position.y > rect.y
                    && position.x < rect.x + rect.w && position.y < rect.y + rect.h) {

                    if (!this._docker._floatingList[i].__checkAnchorDrop(position, false, this, true, undefined, true)) {
                        if (!disableFloating) {
                            this.anchor(position, null);
                        }
                    } else {
                        this._anchor.panel = this._docker._floatingList[i].panel();
                    }
                    return;
                }
            }

            for (var i = 0; i < this._docker._frameList.length; ++i) {
                var rect = this._docker._frameList[i].__rect();
                if (position.x > rect.x && position.y > rect.y
                    && position.x < rect.x + rect.w && position.y < rect.y + rect.h) {

                    if (!this._docker._frameList[i].__checkAnchorDrop(position, false, this, true, undefined, true)) {
                        if (!disableFloating) {
                            this.anchor(position, null);
                        }
                    } else {
                        this._anchor.panel = this._docker._frameList[i].panel();
                    }
                    return;
                }
            }
        },

        /**
         * Get, or Sets the ghost's anchor.
         * @function module:wcGhost#anchor
         * @param {module:wcDocker~Coordinate} [mouse] - If supplied with the anchor, .
         * @param {module:wcDocker~Anchor} [anchor] - If supplied, assigns a new anchor.
         */
        anchor: function (mouse, anchor) {
            if (typeof mouse === 'undefined') {
                return this._anchor;
            }

            if (anchor && this._anchor && anchor.loc === this._anchor.loc && anchor.item === this._anchor.item) {
                return;
            }

            var rect = {
                x: parseInt(this.$ghost.css('left')),
                y: parseInt(this.$ghost.css('top')),
                w: parseInt(this.$ghost.css('width')),
                h: parseInt(this.$ghost.css('height'))
            };

            this._anchorMouse = {
                x: rect.x - mouse.x,
                y: rect.y - mouse.y
            };

            this._rect.x = -this._anchorMouse.x;
            this._rect.y = -this._anchorMouse.y;

            if (!anchor) {
                if (!this._anchor) {
                    return;
                }

                if (this._docker._draggingFrame && this._docker._draggingFrame.$container) {
                    var detachToWidth = this._docker._draggingFrame._panelList[0]._options.detachToWidth || this._docker._options.detachToWidth || this._rect.w;
                    var detachToHeight = this._docker._draggingFrame._panelList[0]._options.detachToHeight || this._docker._options.detachToHeight || this._rect.h;
                    this._rect.w = this._docker.__stringToPixel(detachToWidth, this._docker.$container.width());
                    this._rect.h = this._docker.__stringToPixel(detachToHeight, this._docker.$container.height());
                }

                this._anchor = null;
                this.$ghost.show();
                this.$ghost.stop().animate({
                    opacity: 0.3,
                    'margin-left': this._rect.x - this._rect.w / 2 + 'px',
                    'margin-top': this._rect.y - 10 + 'px',
                    width: this._rect.w + 'px',
                    height: this._rect.h + 'px'
                }, 75);
                return;
            }

            this._anchor = anchor;
            var opacity = 0.8;
            if (anchor.self && anchor.loc === wcDocker.DOCK.STACKED) {
                opacity = 0;
                this.$ghost.hide();
            } else {
                this.$ghost.show();
            }
            this.$ghost.stop().animate({
                opacity: opacity,
                'margin-left': '2px',
                'margin-top': '2px',
                left: anchor.x + 'px',
                top: anchor.y + 'px',
                width: anchor.w + 'px',
                height: anchor.h + 'px'
            }, 75);
        },

        /**
         * Retrieves the rectangle area of the ghost's anchor.
         * @function module:wcGhost#rect
         * @returns {module:wcDocker~AnchorRect} - The rectangle area of the anchor.
         */
        rect: function () {
            return {
                x: this.$ghost.offset().left,
                y: this.$ghost.offset().top,
                w: parseInt(this.$ghost.css('width')),
                h: parseInt(this.$ghost.css('height')),
                tabOrientation: this._anchor && this._anchor.tab
            };
        },

        /**
         * Destroys the instance of the ghost.
         * @function module:wcGhost#destroy
         */
        destroy: function () {
            this.__destroy();
        },

///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function (rect, mouse) {
            this.$ghost = $('<div class="wcGhost">')
                .css('opacity', 0)
                .css('top', rect.y + 'px')
                .css('left', rect.x + 'px')
                .css('width', rect.w + 'px')
                .css('height', rect.h + 'px');

            this._anchorMouse = {
                x: rect.x - mouse.x,
                y: rect.y - mouse.y
            };

            this._rect = {
                x: -this._anchorMouse.x,
                y: -this._anchorMouse.y,
                w: rect.w,
                h: rect.h
            };

            $('body').append(this.$ghost);

            this.anchor(mouse, rect);
        },

        // Updates the size of the layout.
        __move: function (mouse) {
            if (this._anchor) {
                return;
            }

            var x = parseInt(this.$ghost.css('left'));
            var y = parseInt(this.$ghost.css('top'));

            x = mouse.x + this._anchorMouse.x;
            y = mouse.y + this._anchorMouse.y;

            this.$ghost.css('left', x + 'px');
            this.$ghost.css('top', y + 'px');
        },

        // Gets the original size of the moving widget.
        __rect: function () {
            return this._rect;
        },

        // Exorcise the ghost.
        __destroy: function () {
            this.$ghost.stop().animate({
                opacity: 0.0
            }, {
                duration: 100,
                complete: function () {
                    $(this).remove();
                }
            });
        }
    });

    // window['wcGhost'] = Module;

    return Module;

});

/** @module wcSplitter */
define('wcDocker/splitter',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcSplitter
     * Splits an area in two, dividing it with a resize-able splitter bar. This is the same class
     * used throughout [docker]{@link module:wcDocker} to organize the docking interface, but it can also
     * be used inside a panel as a custom widget.
     * <b>Note:</b> The container needs to be positioned in either absolute or relative coordinates in css.
     */
    var Module = dcl(base, {

        declaredClass: 'wcSplitter',

        /**
         * @memberOf module:wcSplitter
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this splitter.
         * @param {wcLayout|wcSplitter|wcDocker} parent   - The splitter's parent object.
         * @param {module:wcDocker.ORIENTATION} orientation      - The orientation of the splitter bar.
         */
        constructor:function(container, parent, orientation) {
            this.$container = $(container);
            this._parent = parent;
            this._orientation = orientation;

            this._pane = [false, false];
            /**
             * An array of two elements representing each side of the splitter.
             * Index 0 is always either top or left depending on [orientation]{@link module:wcDocker.ORIENTATION}.
             * @member
             * @type {external:jQuery~Object[]}
             */
            this.$pane = [];
            this.$bar = null;
            this._pos = 0.5;
            this._posTarget = 0.5;
            this._pixelPos = -1;
            this._findBestPos = false;
            this._anim = 0;

            this._boundEvents = [];

            this.__init();

            this.docker()._splitterList.push(this);
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Initializes the two [panes]{@link module:wcSplitter#$pane} of the splitter with its own layouts.<br>
         * This should be used to initialize the splitter when creating one for use inside your panel.
         * @function module:wcSplitter#initLayouts
         * @param {module:wcDocker.LAYOUT} [topLeftLayout=wcDocker.LAYOUT.TABLE] - The type of layout to use for the top or left pane.
         * @param {module:wcDocker.LAYOUT} [bottomRightLayout=wcDocker.LAYOUT.TABLE] - The type of layout to use for the bottom or right pane.
         */
        initLayouts: function (topLeftLayout, bottomRightLayout) {
            var layoutClass = topLeftLayout || 'wcLayoutTable';
            var layout0 = new (this.docker().__getClass(layoutClass))(this.$pane[0], this);

            layoutClass = bottomRightLayout || 'wcLayoutTable';
            var layout1 = new (this.docker().__getClass(layoutClass))(this.$pane[1], this);

            this.pane(0, layout0);
            this.pane(1, layout1);
        },

        /**
         * Gets, or Sets the orientation of the splitter.
         * @function module:wcSplitter#orientation
         * @param {module:wcDocker.ORIENTATION} orientation - The new orientation of the splitter.
         */
        orientation: function (orientation) {
            if (typeof orientation === 'undefined') {
                return this._orientation;
            }

            if (this._orientation != orientation) {
                this._orientation = orientation;

                if (this._orientation) {
                    // this.$pane[0].removeClass('wcWide').addClass('wcTall');
                    // this.$pane[1].removeClass('wcWide').addClass('wcTall');
                    this.$bar.removeClass('wcWide').removeClass('wcSplitterBarH').addClass('wcTall').addClass('wcSplitterBarV');
                } else {
                    // this.$pane[0].removeClass('wcTall').addClass('wcWide');
                    // this.$pane[1].removeClass('wcTall').addClass('wcWide');
                    this.$bar.removeClass('wcTall').removeClass('wcSplitterBarV').addClass('wcWide').addClass('wcSplitterBarH');
                }

                this.$pane[0].css('top', '').css('left', '').css('width', '').css('height', '');
                this.$pane[1].css('top', '').css('left', '').css('width', '').css('height', '');
                this.$bar.css('top', '').css('left', '').css('width', '').css('height', '');
                this.__update();

                if (this._parent && this._parent.instanceOf('wcPanel')) {
                    this._parent.__trigger(wcDocker.EVENT.UPDATED);
                }
            }
        },

        /**
         * Gets the minimum size constraint of the outer splitter area.
         * @function module:wcSplitter#minSize
         * @returns {module:wcDocker~Size} The minimum size.
         */
        minSize: function () {
            var minSize1;
            var minSize2;
            if (this._pane[0] && typeof this._pane[0].minSize === 'function') {
                minSize1 = this._pane[0].minSize();
            }

            if (this._pane[1] && typeof this._pane[1].minSize === 'function') {
                minSize2 = this._pane[1].minSize();
            }

            if (minSize1 && minSize2) {
                if (this._orientation) {
                    minSize1.x += minSize2.x;
                    minSize1.y = Math.max(minSize1.y, minSize2.y);
                } else {
                    minSize1.y += minSize2.y;
                    minSize1.x = Math.max(minSize1.x, minSize2.x);
                }
                return minSize1;
                return {
                    x: Math.min(minSize1.x, minSize2.x),
                    y: Math.min(minSize1.y, minSize2.y)
                };
            } else if (minSize1) {
                return minSize1;
            } else if (minSize2) {
                return minSize2;
            }

            return false;
        },

        /**
         * Gets the maximum size constraint of the outer splitter area.
         * @function module:wcSplitter#maxSize
         * @returns {module:wcDocker~Size} - The maximum size.
         */
        maxSize: function () {
            var maxSize1;
            var maxSize2;
            if (this._pane[0] && typeof this._pane[0].maxSize === 'function') {
                maxSize1 = this._pane[0].maxSize();
            }

            if (this._pane[1] && typeof this._pane[1].maxSize === 'function') {
                maxSize2 = this._pane[1].maxSize();
            }

            if (maxSize1 && maxSize2) {
                if (this._orientation) {
                    maxSize1.x += maxSize2.x;
                    maxSize1.y = Math.min(maxSize1.y, maxSize2.y);
                } else {
                    maxSize1.y += maxSize2.y;
                    maxSize1.x = Math.min(maxSize1.x, maxSize2.x);
                }
                return maxSize1;
                return {
                    x: Math.min(maxSize1.x, maxSize2.x),
                    y: Math.min(maxSize1.y, maxSize2.y)
                };
            } else if (maxSize1) {
                return maxSize1;
            } else if (maxSize2) {
                return maxSize2;
            }

            return false;
        },

        /**
         * Get, or Set the current splitter position.
         * @function module:wcSplitter#pos
         * @param {Number} [value] - If supplied, assigns a new splitter position. Value must be a percentage value between 0 and 1.
         * @returns {Number} - The current position.
         */
        pos: function (value) {
            if (typeof value !== 'undefined') {
                this._pos = this._posTarget = value;
                this.__update();

                if (this._parent && this._parent.instanceOf('wcPanel')) {
                    this._parent.__trigger(wcDocker.EVENT.UPDATED);
                }
            }

            return this._posTarget;
        },

        /**
         * Animates to a given splitter position.
         * @function module:wcSplitter#animPos
         * @param {Number} value - Assigns the target splitter position. Value must be a percentage between 0 and 1.
         * @param {module:wcSplitter~onFinished} - A finished event handler.
         */
        animPos: function (value, callback) {
            this._posTarget = value;
            var self = this;
            this.$bar.queue(function (next) {
                if (self._anim) {
                    clearInterval(self._anim);
                }
                self._anim = setInterval(function () {
                    if (self._pos > self._posTarget) {
                        self._pos -= (self._pos - self._posTarget) / 5;
                        if (self._pos <= self._posTarget + 0.01) {
                            self._pos = self._posTarget;
                        }
                    }

                    if (self._pos < self._posTarget) {
                        self._pos += (self._posTarget - self._pos) / 5;
                        if (self._pos >= self._posTarget - 0.01) {
                            self._pos = self._posTarget;
                        }
                    }

                    self.__update();
                    if (self._pos == self._posTarget) {
                        callback && callback();
                        next();
                        clearInterval(self._anim);
                        self._anim = 0;
                    }
                }, 5);
            });
            this.$bar.dequeue();
        },

        /**
         * Gets, or Sets the element associated with a pane.
         * @function module:wcSplitter#pane
         * @param {Number} index - The index of the pane, only 0 and 1 are valid.
         * @param {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter} [item] - If supplied, the pane will be replaced with this item.
         * @returns {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter|Boolean} - The current object assigned to the pane, or false.
         */
        pane: function (index, item) {
            if (index >= 0 && index < 2) {
                if (typeof item === 'undefined') {
                    return this._pane[index];
                } else {
                    if (item) {
                        this._pane[index] = item;
                        item._parent = this;
                        item.__container(this.$pane[index]);

                        if (this._pane[0] && this._pane[1]) {
                            this.__update();
                        }
                        return item;
                    } else if (this._pane[index]) {
                        this._pane[index].__container(null);
                        this._pane[index] = false;
                    }
                }
            }
            // this.__update();
            return false;
        },

        /**
         * Gets, or Sets the element associated with the left side pane (for horizontal layouts).
         * @function module:wcSplitter#left
         * @param {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter} [item] - If supplied, the pane will be replaced with this item.
         * @returns {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter|Boolean} - The current object assigned to the pane, or false.
         */
        left: function (item) {
            return this.pane(0, item);
        },

        /**
         * Gets, or Sets the element associated with the right side pane (for horizontal layouts).
         * @function module:wcSplitter#right
         * @param {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter} [item] - If supplied, the pane will be replaced with this item.
         * @returns {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter|Boolean} - The current object assigned to the pane, or false.
         */
        right: function (item) {
            return this.pane(1, item);
        },

        /**
         * Gets, or Sets the element associated with the top pane (for vertical layouts).
         * @function module:wcSplitter#top
         * @param {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter} [item] - If supplied, the pane will be replaced with this item.
         * @returns {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter|Boolean} - The current object assigned to the pane, or false.
         */
        top: function (item) {
            return this.pane(0, item);
        },

        /**
         * Gets, or Sets the element associated with the bottom pane (for vertical layouts).
         * @function module:wcSplitter#bottom
         * @param {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter} [item] - If supplied, the pane will be replaced with this item.
         * @returns {module:wcLayout|module:wcPanel|module:wcFrame|wcSplitter|Boolean} - The current object assigned to the pane, or false.
         */
        bottom: function (item) {
            return this.pane(1, item);
        },

        /**
         * Gets, or Sets whether a pane can be scrolled via scroll bars.
         * By default, scrolling is enabled in both directions.
         * @function module:wcSplitter#scrollable
         * @param {Number} index - The index of the pane, only 0 and 1 are valid.
         * @param {Boolean} [x] - Whether to allow scrolling in the horizontal direction.
         * @param {Boolean} [y] - Whether to allow scrolling in the vertical direction.
         * @returns {module:wcDocker~Scrollable} - The current scroll state for each direction.
         */
        scrollable: function (index, x, y) {
            if (typeof x !== 'undefined') {
                this.$pane[index].toggleClass('wcScrollableX', x);
            }
            if (typeof y !== 'undefined') {
                this.$pane[index].toggleClass('wcScrollableY', y);
            }

            return {
                x: this.$pane[index].hasClass('wcScrollableX'),
                y: this.$pane[index].hasClass('wcScrollableY')
            };
        },

        /**
         * Destroys the splitter.
         * @function module:wcSplitter#destroy
         * @param {Boolean} [destroyPanes=true] - If true, both panes attached will be destroyed as well. Use false if you plan to continue using the objects assigned to each pane, or make sure to remove them first before destruction.
         */
        destroy: function (destroyPanes) {
            var docker = this.docker();
            if (docker) {
                var index = this.docker()._splitterList.indexOf(this);
                if (index > -1) {
                    this.docker()._splitterList.splice(index, 1);
                }
            }

            if (destroyPanes === undefined || destroyPanes) {
                this.__destroy();
            } else {
                this.__container(null);
            }
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            this.$pane.push($('<div class="wcLayoutPane wcScrollableX wcScrollableY">'));
            this.$pane.push($('<div class="wcLayoutPane wcScrollableX wcScrollableY">'));
            this.$bar = $('<div class="wcSplitterBar">');

            if (this._orientation) {
                // this.$pane[0].addClass('wcTall');
                // this.$pane[1].addClass('wcTall');
                this.$bar.addClass('wcTall').addClass('wcSplitterBarV');
            } else {
                // this.$pane[0].addClass('wcWide');
                // this.$pane[1].addClass('wcWide');
                this.$bar.addClass('wcWide').addClass('wcSplitterBarH');
            }

            this.__container(this.$container);

            if (this._parent && this._parent.instanceOf('wcPanel')) {
                this._boundEvents.push({event: wcDocker.EVENT.UPDATED, handler: this.__update.bind(this)});
                this._boundEvents.push({event: wcDocker.EVENT.CLOSED, handler: this.destroy.bind(this)});

                for (var i = 0; i < this._boundEvents.length; ++i) {
                    this._parent.on(this._boundEvents[i].event, this._boundEvents[i].handler);
                }
            }
        },

        // Updates the size of the splitter.
        __update: function (opt_dontMove) {
            var width = this.$container.outerWidth();
            var height = this.$container.outerHeight();

            var minSize = this.__minPos();
            var maxSize = this.__maxPos();

            if (this._findBestPos) {
                this._findBestPos = false;

                var size1;
                var size2;
                if (this._pane[0] && typeof this._pane[0].initSize === 'function') {
                    size1 = this._pane[0].initSize();
                    if (size1) {
                        if (size1.x < 0) {
                            size1.x = width / 2;
                        }
                        if (size1.y < 0) {
                            size1.y = height / 2;
                        }
                    }
                }

                if (this._pane[1] && typeof this._pane[1].initSize === 'function') {
                    size2 = this._pane[1].initSize();
                    if (size2) {
                        if (size2.x < 0) {
                            size2.x = width / 2;
                        }
                        if (size2.y < 0) {
                            size2.y = height / 2;
                        }

                        size2.x = width - size2.x;
                        size2.y = height - size2.y;
                    }
                }

                var size;
                if (size1 && size2) {
                    size = {
                        x: Math.min(size1.x, size2.x),
                        y: Math.min(size1.y, size2.y)
                    };
                } else if (size1) {
                    size = size1;
                } else if (size2) {
                    size = size2;
                }

                if (size) {
                    if (this._orientation) {
                        this._pos = size.x / width;
                    } else {
                        this._pos = size.y / height;
                    }
                }
            }

            this.$bar.toggleClass('wcSplitterBarStatic', this.__isStatic());

            if (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) {
                var barSize = this.$bar.outerWidth() / 2;
                var barBorder = parseInt(this.$bar.css('border-top-width')) + parseInt(this.$bar.css('border-bottom-width'));
                if (opt_dontMove) {
                    var offset = this._pixelPos - (this.$container.offset().left + parseInt(this.$container.css('border-left-width'))) - this.$bar.outerWidth() / 2;
                    this._pos = offset / (width - this.$bar.outerWidth());
                }

                this._pos = Math.min(Math.max(this._pos, 0), 1);
                var size = (width - this.$bar.outerWidth()) * this._pos + barSize;
                if (minSize) {
                    size = Math.max(minSize.x, size);
                }
                if (maxSize) {
                    size = Math.min(maxSize.x, size);
                }

                var top = 0;
                var bottom = 0;
                if (this._parent && this._parent.declaredClass === 'wcCollapser') {
                    var $outer = this.docker().$container;
                    var $inner = this._parent.$container;

                    top = $inner.offset().top - $outer.offset().top;
                    bottom = ($outer.offset().top + $outer.outerHeight()) - ($inner.offset().top + $inner.outerHeight());
                }

                // Bar is top to bottom
                this.$bar.css('left', size - barSize);
                this.$bar.css('top', top);
                this.$bar.css('height', height - barBorder - bottom);
                this.$pane[0].css('width', size - barSize);
                this.$pane[0].css('left', '0px');
                this.$pane[0].css('right', '');
                this.$pane[0].css('top', top);
                this.$pane[0].css('bottom', bottom);
                this.$pane[1].css('left', '');
                this.$pane[1].css('right', '0px');
                this.$pane[1].css('width', width - size - barSize - parseInt(this.$container.css('border-left-width')) * 2);
                this.$pane[1].css('top', top);
                this.$pane[1].css('bottom', bottom);

                this._pixelPos = this.$bar.offset().left + barSize;
            } else {
                var barSize = this.$bar.outerHeight() / 2;
                var barBorder = parseInt(this.$bar.css('border-left-width')) + parseInt(this.$bar.css('border-right-width'));
                if (opt_dontMove) {
                    var offset = this._pixelPos - (this.$container.offset().top + parseInt(this.$container.css('border-top-width'))) - this.$bar.outerHeight() / 2;
                    this._pos = offset / (height - this.$bar.outerHeight());
                }

                this._pos = Math.min(Math.max(this._pos, 0), 1);
                var size = (height - this.$bar.outerHeight()) * this._pos + barSize;
                if (minSize) {
                    size = Math.max(minSize.y, size);
                }
                if (maxSize) {
                    size = Math.min(maxSize.y, size);
                }

                var left = 0;
                var right = 0;
                if (this._parent && this._parent.declaredClass === 'wcCollapser') {
                    var $outer = this.docker().$container;
                    var $inner = this._parent.$container;

                    left = $inner.offset().left - $outer.offset().left;
                    right = ($outer.offset().left + $outer.outerWidth()) - ($inner.offset().left + $inner.outerWidth());
                }

                // Bar is left to right
                this.$bar.css('top', size - barSize);
                this.$bar.css('left', left);
                this.$bar.css('width', width - barBorder - bottom);
                this.$pane[0].css('height', size - barSize);
                this.$pane[0].css('top', '0px');
                this.$pane[0].css('bottom', '');
                this.$pane[0].css('left', left);
                this.$pane[0].css('right', right);
                this.$pane[1].css('top', '');
                this.$pane[1].css('bottom', '0px');
                this.$pane[1].css('height', height - size - barSize - parseInt(this.$container.css('border-top-width')) * 2);
                this.$pane[1].css('left', left);
                this.$pane[1].css('right', right);

                this._pixelPos = this.$bar.offset().top + barSize;
            }

            if (opt_dontMove === undefined) {
                opt_dontMove = true;
            }
            this._pane[0] && this._pane[0].__update(opt_dontMove);
            this._pane[1] && this._pane[1].__update(opt_dontMove);
        },

        // Saves the current panel configuration into a meta
        // object that can be used later to restore it.
        __save: function () {
            // If this is a collapser splitter, do not save it, skip to the children.
            if (this._pane[0] && this._pane[0].declaredClass === 'wcCollapser') {
                return this._pane[1].__save();
            }
            if (this._pane[1] && this._pane[1].declaredClass === 'wcCollapser') {
                return this._pane[0].__save();
            }

            var data = {};
            data.type = 'wcSplitter';
            data.horizontal = this._orientation;
            data.isDrawer = this.$bar.hasClass('wcDrawerSplitterBar');
            data.pane0 = this._pane[0] ? this._pane[0].__save() : null;
            data.pane1 = this._pane[1] ? this._pane[1].__save() : null;
            data.pos = this._pos;
            return data;
        },

        // Restores a previously saved configuration.
        __restore: function (data, docker) {
            this._pos = data.pos;
            if (data.isDrawer) {
                this.$bar.addClass('wcDrawerSplitterBar');
            }
            if (data.pane0) {
                this._pane[0] = docker.__create(data.pane0, this, this.$pane[0]);
                this._pane[0].__restore(data.pane0, docker);
            }
            if (data.pane1) {
                this._pane[1] = docker.__create(data.pane1, this, this.$pane[1]);
                this._pane[1].__restore(data.pane1, docker);
            }
        },

        // Attempts to find the best splitter position based on
        // the contents of each pane.
        __findBestPos: function () {
            this._findBestPos = true;
        },

        // Moves the slider bar based on a mouse position.
        // Params:
        //    mouse       The mouse offset position.
        __moveBar: function (mouse) {
            var offset = this.$container.offset();
            mouse.x -= offset.left;
            mouse.y -= offset.top;

            if (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) {
                var width = this.$container.outerWidth() - this.$bar.outerWidth();
                mouse.x += 1 - parseInt(this.$container.css('border-left-width')) - (this.$bar.outerWidth() / 2);
                this.pos(mouse.x / width);
            } else {
                var height = this.$container.outerHeight() - this.$bar.outerHeight();
                mouse.y += 1 - parseInt(this.$container.css('border-top-width')) - (this.$bar.outerHeight() / 2);
                this.pos(mouse.y / height);
            }
        },

        // Gets the minimum position of the splitter divider.
        __minPos: function () {
            var width = this.$container.outerWidth();
            var height = this.$container.outerHeight();

            var minSize;
            if (this._pane[0] && typeof this._pane[0].minSize === 'function') {
                minSize = this._pane[0].minSize();
            } else {
                minSize = {x: 50, y: 50};
            }

            var maxSize;
            if (this._pane[1] && typeof this._pane[1].maxSize === 'function') {
                maxSize = this._pane[1].maxSize();
            } else {
                maxSize = {x: width, y: height};
            }

            if (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) {
                var barSize = this.$bar.outerWidth() / 2;
                minSize.x += barSize;
                width -= barSize;
            } else {
                var barSize = this.$bar.outerHeight() / 2;
                minSize.y += barSize;
                height -= barSize;
            }

            maxSize.x = width - Math.min(maxSize.x, width);
            maxSize.y = height - Math.min(maxSize.y, height);

            minSize.x = Math.max(minSize.x, maxSize.x);
            minSize.y = Math.max(minSize.y, maxSize.y);

            return minSize;
        },

        // Gets the maximum position of the splitter divider.
        __maxPos: function () {
            var width = this.$container.outerWidth();
            var height = this.$container.outerHeight();

            var maxSize;
            if (this._pane[0] && typeof this._pane[0].maxSize === 'function') {
                maxSize = this._pane[0].maxSize();
            } else {
                maxSize = {x: width, y: height};
            }

            var minSize;
            if (this._pane[1] && typeof this._pane[1].minSize === 'function') {
                minSize = this._pane[1].minSize();
            } else {
                minSize = {x: 50, y: 50};
            }

            if (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) {
                var barSize = this.$bar.outerWidth() / 2;
                maxSize.x += barSize;
                width -= barSize;
            } else {
                var barSize = this.$bar.outerHeight() / 2;
                maxSize.y += barSize;
                height -= barSize;
            }

            minSize.x = width - minSize.x;
            minSize.y = height - minSize.y;

            maxSize.x = Math.min(minSize.x, maxSize.x);
            maxSize.y = Math.min(minSize.y, maxSize.y);
            return maxSize;
        },

        // Retrieves whether the splitter is static (not moveable).
        __isStatic: function () {
            var attr = this._orientation === wcDocker.ORIENTATION.HORIZONTAL ? 'x' : 'y';
            for (var i = 0; i < 2; ++i) {
                if (this._pane[i] && this._pane[i].minSize && this._pane[i].maxSize &&
                    this._pane[i].maxSize()[attr] - this._pane[i].minSize()[attr] === 0) {
                    return true;
                }
            }

            return false;
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;

            if (this.$container) {
                this.$container.append(this.$pane[0]);
                this.$container.append(this.$pane[1]);
                this.$container.append(this.$bar);
            } else {
                this.$pane[0].remove();
                this.$pane[1].remove();
                this.$bar.remove();
            }
            return this.$container;
        },

        // Removes a child from this splitter.
        // Params:
        //    child         The child to remove.
        __removeChild: function (child) {
            if (this._pane[0] === child) {
                this._pane[0] = false;
            } else if (this._pane[1] === child) {
                this._pane[1] = false;
            } else {
                return;
            }

            if (child) {
                child.__container(null);
                child._parent = null;
            }
        },

        // Disconnects and prepares this widget for destruction.
        __destroy: function () {
            // Stop any animations.
            if (this._anim) {
                clearInterval(this._anim);
                this._anim = 0;
            }
            this.$bar.clearQueue();

            // Remove all registered events.
            while (this._boundEvents.length) {
                this._parent.off(this._boundEvents[0].event, this._boundEvents[0].handler);
                this._boundEvents.shift();
            }

            if (this._pane[0]) {
                this._pane[0].__destroy();
                this._pane[0] = null;
            }
            if (this._pane[1]) {
                this._pane[1].__destroy();
                this._pane[1] = null;
            }

            this.__container(null);
            this._parent = false;
        }
    });

    // window['wcSplitter'] = Module;

    return Module;
});

/**
 * A callback function that is called when an action is finished.
 *
 * @callback wcSplitter~onFinished
 */
;
/** @module wcFrame */
define('wcDocker/frame',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcFrame
     * The frame is a [panel]{@link module:wcPanel} container.
     * Each panel appears as a tabbed item inside a frame.
     */
    var Module = dcl(base, {
        declaredClass: 'wcFrame',

        LEFT_TAB_BUFFER: 15,

        /**
         * <b><i>PRIVATE<i> - Handled internally by [docker]{@link module:wcDocker} and <u>should never be constructed by the user.</u></b>
         * @memberOf module:wcFrame
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this frame.
         * @param {module:wcSplitter|wcDocker} parent - The frames parent object.
         * @param {Boolean} isFloating - If true, the frame will be a floating window.
         */
        constructor: function (container, parent, isFloating) {
            /**
             * The container that holds the frame.
             * @member {external:jQuery~Object}
             */
            this.$container = $(container);
            this._parent = parent;
            this._isFloating = isFloating;

            /**
             * The outer frame element.
             * @member {external:jQuery~Object}
             */
            this.$frame = null;
            this.$title = null;
            this.$titleBar = null;
            this.$tabBar = null;
            this.$tabScroll = null;
            this.$center = null;
            this.$tabLeft = null;
            this.$tabRight = null;
            this.$close = null;
            this.$collapse = null;
            this.$top = null;
            this.$bottom = null;
            this.$left = null;
            this.$right = null;
            this.$corner1 = null;
            this.$corner2 = null;
            this.$corner3 = null;
            this.$corner4 = null;
            this.$buttonBar = null;

            this.$shadower = null;
            this.$modalBlocker = null;

            this._titleVisible = true;
            this._canScrollTabs = false;
            this._tabOrientation = wcDocker.TAB.TOP;
            this._tabScrollPos = 0;
            this._curTab = -1;
            this._panelList = [];
            this._buttonList = [];

            this._resizeData = {
                time: -1,
                timeout: false,
                delta: 150
            };

            this._pos = {
                x: 0.5,
                y: 0.5
            };

            this._size = {
                x: 400,
                y: 400
            };

            this._lastSize = {
                x: 400,
                y: 400
            };

            this._anchorMouse = {
                x: 0,
                y: 0
            };

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Gets, or Sets the position of the frame.
         * @function module:wcFrame#pos
         * @param {Number} [x]        - If supplied, assigns a new horizontal position.
         * @param {Number} [y]        - If supplied, assigns a new vertical position.
         * @param {Boolean} [pixels]  - If true, the coordinates passed in will be treated as a pixel position rather than a percentage.
         * @returns {module:wcDocker~Coordinate} - The current position of the frame. If the pixel parameter was true, the position will be in pixels.
         */
        pos: function (x, y, pixels) {
            var width = this.$container.width();
            var height = this.$container.height();

            if (typeof x === 'undefined') {
                if (pixels) {
                    return {x: this._pos.x * width, y: this._pos.y * height};
                } else {
                    return {x: this._pos.x, y: this._pos.y};
                }
            }

            if (pixels) {
                this._pos.x = x / width;
                this._pos.y = y / height;
            } else {
                this._pos.x = x;
                this._pos.y = y;
            }
        },

        /**
         * Gets the initially desired size of the panel.
         * @function module:wcFrame#initSize
         * @returns {module:wcDocker~Size} - The initially desired size.
         */
        initSize: function () {
            var size = {
                x: -1,
                y: -1
            };

            for (var i = 0; i < this._panelList.length; ++i) {
                if (size.x < this._panelList[i].initSize().x) {
                    size.x = this._panelList[i].initSize().x;
                }
                if (size.y < this._panelList[i].initSize().y) {
                    size.y = this._panelList[i].initSize().y;
                }
            }

            if (size.x < 0 || size.y < 0) {
                return false;
            }
            return size;
        },

        /**
         * Gets the minimum size of the frame.
         * @function module:wcFrame#minSize
         * @returns {module:wcDocker~Size} - The minimum size of the frame.
         */
        minSize: function () {
            var size = {
                x: 0,
                y: 0
            };

            for (var i = 0; i < this._panelList.length; ++i) {
                size.x = Math.max(size.x, this._panelList[i].minSize().x);
                size.y = Math.max(size.y, this._panelList[i].minSize().y);
            }
            return size;
        },

        /**
         * Gets the maximum size of the frame.
         * @function module:wcFrame#maxSize
         * @returns {module:wcDocker~Size} - The maximum size of the frame.
         */
        maxSize: function () {
            var size = {
                x: Infinity,
                y: Infinity
            };

            for (var i = 0; i < this._panelList.length; ++i) {
                size.x = Math.min(size.x, this._panelList[i].maxSize().x);
                size.y = Math.min(size.y, this._panelList[i].maxSize().y);
            }
            return size;
        },

        /**
         * Gets, or Sets the tab orientation for the frame. This puts the tabbed widgets visually on any side of the frame.
         * @version 3.0.0
         * @function module:wcFrame#tabOrientation
         * @param {module:wcDocker.TAB} [orientation] - Assigns the orientation of the tab items displayed.
         * @returns {module:wcDocker.TAB} - The current orientation.
         */
        tabOrientation: function (orientation) {
            if (orientation !== undefined) {
                if (this._tabOrientation !== orientation && this.docker()._canOrientTabs) {
                    this._tabOrientation = orientation;

                    this.__updateTabs();
                    this.__updateTabs();
                }
            }

            return this._tabOrientation
        },

        /**
         * Adds a given panel as a new tab item to the frame.
         * @function module:wcFrame#addPanel
         * @param {module:wcPanel} panel         - The panel to add.
         * @param {Number} [index]        - Insert index.
         */
        addPanel: function (panel, index) {
            var found = this._panelList.indexOf(panel);
            if (found !== -1) {
                this._panelList.splice(found, 1);
            }

            if (typeof index === 'undefined') {
                this._panelList.push(panel);
            } else {
                this._panelList.splice(index, 0, panel);
            }

            if (this._curTab === -1 && this._panelList.length) {
                if (!this.isCollapser()) {
                    this._curTab = 0;
                }
                this._size = this.initSize();
            }

            this.__updateTabs();
        },

        /**
         * Removes a given panel from the frame.
         * @function module:wcFrame#removePanel
         * @param {module:wcPanel} panel - The panel to remove.
         * @returns {Boolean} - True if any panels still remain after the removal.
         */
        removePanel: function (panel) {
            for (var i = 0; i < this._panelList.length; ++i) {
                if (this._panelList[i] === panel) {
                    if (this.isCollapser()) {
                        this._curTab = -1;
                    } else if (this._curTab >= i) {
                        this._curTab--;
                    }

                    // Only null out the container if it is still attached to this frame.
                    if (this._panelList[i]._parent === this) {
                        this._panelList[i].__container(null);
                        this._panelList[i]._parent = null;
                    }

                    this._panelList.splice(i, 1);
                    panel._isVisible = false;
                    break;
                }
            }

            if (this._curTab === -1) {
                if (!this.collapse() && this._panelList.length) {
                    this._curTab = 0;
                }
            }

            this.__updateTabs();
            return this._panelList.length > 0;
        },

        /**
         * Gets, or Sets the currently visible panel.
         * @function module:wcFrame#panel
         * @param {Number} [tabIndex] - If supplied, sets the current panel index.
         * @param {Boolean} [autoFocus] - If true, this tab will be focused (brought to front).
         * @returns {module:wcPanel} - The currently visible panel.
         */
        panel: function (tabIndex, autoFocus) {
            if (typeof tabIndex !== 'undefined') {
                if (this.isCollapser() && tabIndex === this._curTab) {
                    this.collapse();
                    tabIndex = -1;
                }
                if (tabIndex < this._panelList.length) {
                    this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + this._curTab + '"]').removeClass('wcPanelTabActive');
                    this.$center.children('.wcPanelTabContent[id="' + this._curTab + '"]').addClass('wcPanelTabContentHidden');
                    if (this._curTab !== tabIndex) {
                        this.collapse();
                    }
                    this._curTab = tabIndex;
                    if (tabIndex > -1) {
                        this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + tabIndex + '"]').addClass('wcPanelTabActive');
                        this.$center.children('.wcPanelTabContent[id="' + tabIndex + '"]').removeClass('wcPanelTabContentHidden');
                        this.expand();
                    }
                    this.__updateTabs(autoFocus);
                }
            }

            if (this._curTab > -1 && this._curTab < this._panelList.length) {
                return this._panelList[this._curTab];
            } else if (this.isCollapser() && this._panelList.length) {
                return this._panelList[0];
            }
            return false;
        },

        /**
         * Gets whether this frame is inside a collapser.
         * @function module:wcFrame#isCollapser
         * @returns {Boolean} - Whether this frame is inside a collapser.
         */
        isCollapser: function () {
            return (this._parent && this._parent.declaredClass === 'wcDrawer');
        },

        /**
         * Collapses the frame, if it is a collapser.
         * @function module:wcFrame#collapse
         * @param {Boolean} [instant] - If true, collapses without animating.
         */
        collapse: function (instant) {
            if (this.isCollapser()) {
                this._parent.collapse(instant);
                return true;
            }
            return false;
        },

        /**
         * Expands the frame, if it is a collapser.
         * @function module:wcFrame#expand
         */
        expand: function () {
            if (this.isCollapser()) {
                this._parent.expand();
                return true;
            }
            return false;
        },

        /**
         * Gets whether the frame is expanded, if it is a collapser.
         * @function module:wcFrame#isExpanded
         * @returns {Boolean|undefined} - The current expanded state, or undefined if it is not a collapser.
         */
        isExpanded: function () {
            if (this.isCollapser()) {
                return this._parent.isExpanded();
            }
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            this.$frame = $('<div class="wcFrame wcWide wcTall">');
            this.$title = $('<div class="wcFrameTitle">');
            this.$titleBar = $('<div class="wcFrameTitleBar wcFrameTopper">');
            this.$tabBar = $('<div class="wcFrameTitleBar">');
            this.$tabScroll = $('<div class="wcTabScroller">');
            this.$center = $('<div class="wcFrameCenter wcPanelBackground">');
            this.$tabLeft = $('<div class="wcFrameButton" title="Scroll tabs to the left."><span class="fa fa-arrow-left"></span>&lt;</div>');
            this.$tabRight = $('<div class="wcFrameButton" title="Scroll tabs to the right."><span class="fa fa-arrow-right"></span>&gt;</div>');
            this.$close = $('<div class="wcFrameButton" title="Remove panel"><div class="fa fa-close"></div>X</div>');

            this.$collapse = $('<div class="wcFrameButton" title="Collapse the active panel"><div class="fa fa-download"></div>C</div>');
            this.$buttonBar = $('<div class="wcFrameButtonBar">');
            this.$tabButtonBar = $('<div class="wcFrameButtonBar">');

            this.$tabBar.append(this.$tabScroll);
            this.$tabBar.append(this.$tabButtonBar);
            this.$frame.append(this.$buttonBar);
            this.$buttonBar.append(this.$close);
            this.$buttonBar.append(this.$collapse);
            this.$frame.append(this.$center);

            if (this._isFloating) {
                this.$top = $('<div class="wcFrameEdgeH wcFrameEdge"></div>').css('top', '0px').css('left', '0px').css('right', '0px');
                this.$bottom = $('<div class="wcFrameEdgeH wcFrameEdge"></div>').css('bottom', '0px').css('left', '0px').css('right', '0px');
                this.$left = $('<div class="wcFrameEdgeV wcFrameEdge"></div>').css('left', '0px').css('top', '0px').css('bottom', '0px');
                this.$right = $('<div class="wcFrameEdgeV wcFrameEdge"></div>').css('right', '0px').css('top', '0px').css('bottom', '0px');
                this.$corner1 = $('<div class="wcFrameCornerNW wcFrameEdge"></div>').css('top', '0px').css('left', '0px');
                this.$corner2 = $('<div class="wcFrameCornerNE wcFrameEdge"></div>').css('top', '0px').css('right', '0px');
                this.$corner3 = $('<div class="wcFrameCornerNW wcFrameEdge"></div>').css('bottom', '0px').css('right', '0px');
                this.$corner4 = $('<div class="wcFrameCornerNE wcFrameEdge"></div>').css('bottom', '0px').css('left', '0px');

                this.$frame.append(this.$top);
                this.$frame.append(this.$bottom);
                this.$frame.append(this.$left);
                this.$frame.append(this.$right);
                this.$frame.append(this.$corner1);
                this.$frame.append(this.$corner2);
                this.$frame.append(this.$corner3);
                this.$frame.append(this.$corner4);
            }

            this.__container(this.$container);

            if (this._isFloating) {
                this.$frame.addClass('wcFloating');
            }

            this.$center.scroll(this.__scrolled.bind(this));
        },

        // Updates the size of the frame.
        __update: function () {
            var width = this.$container.width();
            var height = this.$container.height();

            // Floating windows manage their own sizing.
            if (this._isFloating) {
                var left = (this._pos.x * width) - this._size.x / 2;
                var top = (this._pos.y * height) - this._size.y / 2;

                if (top < 0) {
                    top = 0;
                }

                if (left + this._size.x / 2 < 0) {
                    left = -this._size.x / 2;
                }

                if (left + this._size.x / 2 > width) {
                    left = width - this._size.x / 2;
                }

                if (top + parseInt(this.$center.css('top')) > height) {
                    top = height - parseInt(this.$center.css('top'));
                }

                this.$frame.css('left', left + 'px');
                this.$frame.css('top', top + 'px');
                this.$frame.css('width', this._size.x + 'px');
                this.$frame.css('height', this._size.y + 'px');
            }

            if (width !== this._lastSize.x || height !== this._lastSize.y) {
                this._lastSize.x = width;
                this._lastSize.y = height;

                this._resizeData.time = new Date();
                if (!this._resizeData.timeout) {
                    this._resizeData.timeout = true;
                    setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
                }
            }
            // this.__updateTabs();
            this.__onTabChange();
        },

        __resizeEnd: function () {
            this.__updateTabs();
            if (new Date() - this._resizeData.time < this._resizeData.delta) {
                setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
            } else {
                this._resizeData.timeout = false;
            }
        },

        // Triggers an event exclusively on the docker and none of its panels.
        // Params:
        //    eventName   The name of the event.
        //    data        A custom data parameter to pass to all handlers.
        __trigger: function (eventName, data) {
            for (var i = 0; i < this._panelList.length; ++i) {
                this._panelList[i].__trigger(eventName, data);
            }
        },

        // Saves the current panel configuration into a meta
        // object that can be used later to restore it.
        __save: function () {
            var data = {};
            data.type = 'wcFrame';
            data.floating = this._isFloating;
            data.isFocus = this.$frame.hasClass('wcFloatingFocus');
            data.tabOrientation = this._tabOrientation;
            data.pos = {
                x: this._pos.x,
                y: this._pos.y
            };
            data.size = {
                x: this._size.x,
                y: this._size.y
            };
            data.tab = this._curTab;
            data.panels = [];
            for (var i = 0; i < this._panelList.length; ++i) {
                data.panels.push(this._panelList[i].__save());
            }
            return data;
        },

        // Restores a previously saved configuration.
        __restore: function (data, docker) {
            this._isFloating = data.floating;
            this._tabOrientation = data.tabOrientation || wcDocker.TAB.TOP;
            this._pos.x = data.pos.x;
            this._pos.y = data.pos.y;
            this._size.x = data.size.x;
            this._size.y = data.size.y;
            this._curTab = data.tab;
            for (var i = 0; i < data.panels.length; ++i) {
                var panel = docker.__create(data.panels[i], this, this.$center);
                panel.__restore(data.panels[i], docker);
                this._panelList.push(panel);
            }

            this.__update();

            if (data.isFocus) {
                this.$frame.addClass('wcFloatingFocus');
            }
        },

        __updateTabs: function (autoFocus) {
            this.$tabScroll.empty();

            var getOffset = function ($item) {
                switch (this._tabOrientation) {
                    case wcDocker.TAB.BOTTOM:
                        return $item.offset().left;
                    case wcDocker.TAB.TOP:
                        return $item.offset().left;
                    case wcDocker.TAB.LEFT:
                        return $item.offset().top;
                    case wcDocker.TAB.RIGHT:
                        return $item.offset().top;
                }
            }.bind(this);

            var visibilityChanged = [];
            var tabPositions = [];
            var totalWidth = 0;
            var parentLeft = getOffset(this.$tabScroll);
            var showTabs = this._panelList.length > 1 || this.isCollapser();
            var self = this;

            if (this.isCollapser()) {
                // this.$titleBar.addClass('wcNotMoveable');
                this.$tabBar.addClass('wcNotMoveable');
            } else {
                this.$titleBar.removeClass('wcNotMoveable');
                this.$tabBar.removeClass('wcNotMoveable');
            }

            this.$center.children('.wcPanelTabContent').each(function () {
                $(this).addClass('wcPanelTabContentHidden wcPanelTabUnused');
            });

            this._titleVisible = true;
            this.$title.html('');

            // Determine if the title and tabs are visible based on the panels inside.
            for (var i = 0; i < this._panelList.length; ++i) {
                var panel = this._panelList[i];

                var $tab = null;
                if (showTabs) {
                    $tab = panel.$title;
                    panel.$title.attr('id', i);
                    this.$tabScroll.append(panel.$title);
                }

                if (!panel.moveable()) {
                    this.$titleBar.addClass('wcNotMoveable');
                    this.$tabBar.addClass('wcNotMoveable');
                }

                if (!panel._titleVisible) {
                    this._titleVisible = false;
                }

                var $tabContent = this.$center.children('.wcPanelTabContent[id="' + i + '"]');
                if (!$tabContent.length) {
                    $tabContent = $('<div class="wcPanelTabContent wcPanelTabContentHidden" id="' + i + '">');
                    this.$center.append($tabContent);
                }

                panel.__container($tabContent);
                panel._parent = this;

                var isVisible = this._curTab === i;
                if (panel.isVisible() !== isVisible) {
                    visibilityChanged.push({
                        panel: panel,
                        isVisible: isVisible
                    });
                }

                $tabContent.removeClass('wcPanelTabUnused');

                if (isVisible) {
                    $tab && $tab.addClass('wcPanelTabActive');
                    $tabContent.removeClass('wcPanelTabContentHidden');
                    this.$title.html(panel.title());
                    if (panel.$icon) {
                        var $icon = panel.$icon.clone();
                        this.$title.prepend($icon);
                    }
                }

                if ($tab) {
                    totalWidth = getOffset($tab) - parentLeft;
                    tabPositions.push(totalWidth);

                    totalWidth += $tab.outerWidth();
                }
            }

            var $topBar = this.$titleBar;
            var tabWidth = 0;
            if (this._titleVisible) {
                if (!this.$frame.parent()) {
                    this.$center.css('top', '');
                }
                switch (this._tabOrientation) {
                    case wcDocker.TAB.TOP:
                        this.$frame.prepend(this.$tabBar);
                        this.$titleBar.remove();
                        this.$tabBar.addClass('wcTabTop').removeClass('wcTabLeft wcTabRight wcTabBottom');
                        // this.$tabBar.css('margin-top', '');
                        if (showTabs) {
                            this.$title.remove();
                        } else {
                            this.$tabBar.prepend(this.$title);
                        }
                        $topBar = this.$tabBar;
                        this.$center.css('left', 0).css('right', 0).css('bottom', 0);
                        tabWidth = this.$center.width();
                        break;
                    case wcDocker.TAB.BOTTOM:
                        this.$frame.prepend(this.$titleBar);
                        this.$titleBar.append(this.$title);

                        if (showTabs) {
                            var titleSize = this.$titleBar.height();
                            this.$frame.append(this.$tabBar);
                            this.$tabBar.addClass('wcTabBottom').removeClass('wcTabTop wcTabLeft wcTabRight');
                            // this.$tabBar.css('margin-top', '');

                            this.$center.css('left', 0).css('right', 0).css('bottom', titleSize);
                        } else {
                            this.$tabBar.remove();
                        }
                        tabWidth = this.$center.width();
                        break;

                    case wcDocker.TAB.LEFT:
                        this.$frame.prepend(this.$titleBar);
                        this.$titleBar.append(this.$title);

                        if (showTabs) {
                            var titleSize = this.$titleBar.height();
                            this.$frame.append(this.$tabBar);
                            this.$tabBar.addClass('wcTabLeft').removeClass('wcTabTop wcTabRight wcTabBottom');
                            // this.$tabBar.css('margin-top', titleSize);

                            this.$center.css('left', titleSize).css('right', 0).css('bottom', 0);
                        } else {
                            this.$tabBar.remove();
                        }
                        tabWidth = this.$center.height();
                        break;

                    case wcDocker.TAB.RIGHT:
                        this.$frame.prepend(this.$titleBar);
                        this.$titleBar.append(this.$title);

                        if (showTabs) {
                            var titleSize = this.$titleBar.height();
                            this.$frame.append(this.$tabBar);
                            this.$tabBar.addClass('wcTabRight').removeClass('wcTabTop wcTabLeft wcTabBottom');
                            // this.$tabBar.css('margin-top', titleSize);

                            this.$center.css('left', 0).css('right', titleSize).css('bottom', 0);
                        } else {
                            this.$tabBar.remove();
                        }
                        tabWidth = this.$center.height();
                        break;
                }
                if (!showTabs) {
                    this.$center.css('left', 0).css('right', 0).css('bottom', 0);
                }
            } else {
                this.$titleBar.remove();
                this.$tabBar.remove();
                this.$center.css('top', 0).css('left', 0).css('right', 0).css('bottom', 0);
            }

            // Now remove all unused panel tabs.
            this.$center.children('.wcPanelTabUnused').each(function () {
                $(this).remove();
            });

            if (this._titleVisible) {
                var buttonSize = this.__onTabChange();

                if (autoFocus) {
                    for (var i = 0; i < tabPositions.length; ++i) {
                        if (i === this._curTab) {
                            var left = tabPositions[i];
                            var right = totalWidth;
                            if (i + 1 < tabPositions.length) {
                                right = tabPositions[i + 1];
                            }

                            var scrollPos = -parseInt(this.$tabScroll.css('left'));
                            var titleWidth = tabWidth - buttonSize;

                            // If the tab is behind the current scroll position.
                            if (left < scrollPos) {
                                this._tabScrollPos = left - this.LEFT_TAB_BUFFER;
                                if (this._tabScrollPos < 0) {
                                    this._tabScrollPos = 0;
                                }
                            }
                            // If the tab is beyond the current scroll position.
                            else if (right - scrollPos > titleWidth) {
                                this._tabScrollPos = right - titleWidth + this.LEFT_TAB_BUFFER;
                            }
                            break;
                        }
                    }
                }

                this._canScrollTabs = false;
                if (totalWidth > tabWidth - buttonSize) {
                    this._canScrollTabs = this._titleVisible;
                    if (this._canScrollTabs) {
                        this.$tabButtonBar.append(this.$tabRight);
                        this.$tabButtonBar.append(this.$tabLeft);
                        buttonSize += this.$tabRight.outerWidth();
                        buttonSize += this.$tabLeft.outerWidth();
                    }

                    var scrollLimit = totalWidth - (tabWidth - buttonSize) / 2;
                    // If we are beyond our scroll limit, clamp it.
                    if (this._tabScrollPos > scrollLimit) {
                        var children = this.$tabScroll.children();
                        for (var i = 0; i < children.length; ++i) {
                            var $tab = $(children[i]);

                            totalWidth = getOffset($tab) - parentLeft;
                            if (totalWidth + $tab.outerWidth() > scrollLimit) {
                                this._tabScrollPos = totalWidth - this.LEFT_TAB_BUFFER;
                                if (this._tabScrollPos < 0) {
                                    this._tabScrollPos = 0;
                                }
                                break;
                            }
                        }
                    }
                } else {
                    this._tabScrollPos = 0;
                    this.$tabLeft.remove();
                    this.$tabRight.remove();
                }

                this.$tabScroll.stop().animate({left: -this._tabScrollPos + 'px'}, 'fast');

                // Update visibility on panels.
                for (var i = 0; i < visibilityChanged.length; ++i) {
                    visibilityChanged[i].panel.__isVisible(visibilityChanged[i].isVisible);
                }
            }
        },

        __onTabChange: function () {
            var buttonSize = 0;
            var tabButtonSize = 0;
            var panel = this.panel();

            this.$tabLeft.remove();
            this.$tabRight.remove();
            this.$close.hide();
            this.$collapse.hide();

            while (this._buttonList.length) {
                this._buttonList.pop().remove();
            }

            if (panel) {
                var scrollable = panel.scrollable();
                this.$center.toggleClass('wcScrollableX', scrollable.x);
                this.$center.toggleClass('wcScrollableY', scrollable.y);
                this.$frame.toggleClass('wcOverflowVisible', panel.overflowVisible());
                this.$center.toggleClass('wcOverflowVisible', panel.overflowVisible());

                if (!this.isCollapser() || this.isExpanded()) {
                    if (panel.closeable()) {
                        this.$close.show();
                        buttonSize += this.$close.outerWidth();
                    }

                    var docker = this.docker();
                    if (docker.isCollapseEnabled() && panel.moveable() && panel.collapsible() && !this._isFloating && !panel._isPlaceholder) {
                        if (this.isCollapser()) {
                            // Un-collapse
                            var $icon = this.$collapse.children('div');
                            $icon[0].className = 'fa fa-sign-out';
                            switch (this._parent._position) {
                                case wcDocker.DOCK.LEFT:
                                    $icon.addClass('wcCollapseLeft');
                                    break;
                                case wcDocker.DOCK.RIGHT:
                                    $icon.addClass('wcCollapseRight');
                                    break;
                                case wcDocker.DOCK.BOTTOM:
                                    $icon.addClass('wcCollapseBottom');
                                    break;
                            }
                            $icon.addClass('wcCollapsed');
                            this.$collapse.show();
                            this.$collapse.attr('title', 'Dock this collapsed panel back into the main layout.');
                            buttonSize += this.$collapse.outerWidth();
                        } else {
                            var direction = wcDocker.DOCK.BOTTOM;
                            if (panel._collapseDirection === wcDocker.DOCK.LEFT ||
                                panel._collapseDirection === wcDocker.DOCK.RIGHT ||
                                panel._collapseDirection === wcDocker.DOCK.BOTTOM) {
                                // Static collapse direction.
                                direction = panel._collapseDirection;
                            } else {
                                // Determine the direction to collapse based on the frame center.
                                var $inner = docker.$container;
                                if (!$.isEmptyObject(docker._collapser) && docker._collapser.hasOwnProperty(wcDocker.DOCK.RIGHT)) {
                                    // Get the inner contents element not taken up by the collapsible drawers.
                                    $inner = docker._collapser[wcDocker.DOCK.RIGHT]._parent.$pane[0];
                                }

                                var outer = $inner.offset();
                                var bounds = this.$container.offset();
                                bounds.right = (bounds.left + this.$container.width() - outer.left) / $inner.width();
                                bounds.bottom = (bounds.top + this.$container.height() - outer.top) / $inner.height();
                                bounds.top = (bounds.top - outer.top) / $inner.height();
                                bounds.left = (bounds.left - outer.left) / $inner.width();

                                if (typeof panel._collapseDirection === 'function') {
                                    // Custom collapse handler.
                                    direction = panel._collapseDirection(bounds);
                                } else {
                                    // Default collapse calculation.
                                    if (bounds.top > 0.5 && bounds.bottom > 0.95) {
                                        direction = wcDocker.DOCK.BOTTOM;
                                    } else if (bounds.left <= 0.05) {
                                        direction = wcDocker.DOCK.LEFT;
                                    } else if (bounds.right >= 0.95) {
                                        direction = wcDocker.DOCK.RIGHT;
                                    } else if (bounds.bottom > 0.95) {
                                        direction = wcDocker.DOCK.BOTTOM;
                                    }
                                }
                            }

                            var directionLabel = '';
                            var directionClass = '';
                            switch (direction) {
                                case wcDocker.DOCK.LEFT:
                                    directionLabel = 'left side.';
                                    directionClass = 'wcCollapseLeft';
                                    break;
                                case wcDocker.DOCK.RIGHT:
                                    directionLabel = 'right side.';
                                    directionClass = 'wcCollapseRight';
                                    break;
                                case wcDocker.DOCK.BOTTOM:
                                    directionLabel = 'bottom.';
                                    directionClass = 'wcCollapseBottom';
                                    break;
                            }

                            if (directionLabel) {
                                var $icon = this.$collapse.children('div');
                                $icon[0].className = 'fa fa-sign-in';
                                $icon.addClass(directionClass);
                                $icon.addClass('wcCollapsible');
                                this.$collapse.show();
                                this.$collapse.attr('title', 'Collapse this panel into the ' + directionLabel);
                                buttonSize += this.$collapse.outerWidth();
                            }
                        }
                    }

                    for (var i = 0; i < panel._buttonList.length; ++i) {
                        var buttonData = panel._buttonList[i];
                        var $button = $(document.createElement('div'));
                        var customButtonClass = buttonData.className;
                        var buttonClassName = 'wcFrameButton';
                        if (buttonData.isTogglable) {
                            buttonClassName += ' wcFrameButtonToggler';
                            if (buttonData.isToggled) {
                                buttonClassName += ' wcFrameButtonToggled';
                                customButtonClass = buttonData.toggleClassName || customButtonClass;
                            }
                        }
                        $button.attr('class', buttonClassName);
                        $button.attr('title', buttonData.tip);
                        $button.data('name', buttonData.name);
                        $button.text(buttonData.text);
                        if (customButtonClass) {
                            var wrapper = document.createElement('div');
                            wrapper.className = customButtonClass;
                            $button.prepend($(wrapper));
                        }

                        this._buttonList.push($button);
                        this.$buttonBar.append($button);
                        buttonSize += $button.outerWidth();
                    }
                }

                if (this._canScrollTabs) {
                    this.$tabButtonBar.append(this.$tabRight);
                    this.$tabButtonBar.append(this.$tabLeft);

                    tabButtonSize += this.$tabRight.outerWidth() + this.$tabLeft.outerWidth();
                }

                if (this._titleVisible) {
                    this.$buttonBar[0].style.right = '';
                    switch (this._tabOrientation) {
                        case wcDocker.TAB.RIGHT:
                            this.$buttonBar[0].style.right = this.$tabBar.height();
                            break;
                        case wcDocker.TAB.LEFT:
                            this.$buttonBar[0].style.width = this.$center.height() + this.$tabBar.height();
                            break;
                        case wcDocker.TAB.BOTTOM:
                            this.$buttonBar[0].style.width = this.$center.width();
                            break;
                        default:
                            break;
                    }
                }

                panel.__update();

                this.$center.scrollLeft(panel._scroll.x);
                this.$center.scrollTop(panel._scroll.y);
            }

            this.$buttonBar.css('min-width', buttonSize).css('width', buttonSize);
            this.$tabButtonBar.css('min-width', tabButtonSize).css('width', tabButtonSize);

            if (this._tabOrientation === wcDocker.TAB.TOP) {
                this.$tabButtonBar.css('right', buttonSize);
                return buttonSize + tabButtonSize;
            } else {
                this.$tabButtonBar.css('right', 0);
                return tabButtonSize;
            }
        },

        // Handles scroll notifications.
        __scrolled: function () {
            var panel = this.panel();
            panel._scroll.x = this.$center.scrollLeft();
            panel._scroll.y = this.$center.scrollTop();

            panel.__trigger(wcDocker.EVENT.SCROLLED);
        },

        // Brings the frame into focus.
        // Params:
        //    flash     Optional, if true will flash the window.
        __focus: function (flash) {
            if (flash) {
                var $flasher = $('<div class="wcFrameFlasher">');
                this.$frame.append($flasher);
                $flasher.animate({
                    opacity: 1
                }, 100)
                    .animate({
                        opacity: 0.0
                    }, 100)
                    .animate({
                        opacity: 0.6
                    }, 50)
                    .animate({
                        opacity: 0.0
                    }, 50)
                    .queue(function (next) {
                        $flasher.remove();
                        next();
                    });
            }
        },

        // Moves the panel based on mouse dragging.
        // Params:
        //    mouse     The current mouse position.
        __move: function (mouse) {
            var width = this.$container.width();
            var height = this.$container.height();

            this._pos.x = (mouse.x + this._anchorMouse.x) / width;
            this._pos.y = (mouse.y + this._anchorMouse.y) / height;
        },

        // Sets the anchor position for moving the panel.
        // Params:
        //    mouse     The current mouse position.
        __anchorMove: function (mouse) {
            var width = this.$container.width();
            var height = this.$container.height();

            this._anchorMouse.x = (this._pos.x * width) - mouse.x;
            this._anchorMouse.y = (this._pos.y * height) - mouse.y;
        },

        // Moves a tab from a given index to another index.
        // Params:
        //    fromIndex     The current tab index to move.
        //    toIndex       The new index to move to.
        // Returns:
        //    element       The new element of the moved tab.
        //    false         If an error occurred.
        __tabMove: function (fromIndex, toIndex) {
            if (fromIndex >= 0 && fromIndex < this._panelList.length &&
                toIndex >= 0 && toIndex < this._panelList.length) {
                var panel = this._panelList.splice(fromIndex, 1);
                this._panelList.splice(toIndex, 0, panel[0]);

                // Preserve the currently active tab.
                if (this._curTab === fromIndex) {
                    this._curTab = toIndex;
                }

                this.__updateTabs();

                return this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + toIndex + '"]')[0];
            }
            return false;
        },

        // Checks if the mouse is in a valid anchor position for docking a panel.
        // Params:
        //    mouse       The current mouse position.
        //    same        Whether the moving frame and this one are the same.
        //    ghost       The ghost object.
        //    canSplit    Whether the frame can be split
        //    isTopper    Whether the user is dragging the topper (top title bar).
        //    allowEdges  Whether to allow edge docking.
        __checkAnchorDrop: function (mouse, same, ghost, canSplit, isTopper, allowEdges) {
            var panel = this.panel();
            if (panel && panel.moveable()) {
                return panel.layout().__checkAnchorDrop(mouse, same && this._tabOrientation, ghost, (!this._isFloating && !this.isCollapser() && canSplit), this.$frame, panel.moveable() && panel.title(), isTopper, this.isCollapser() ? this._tabOrientation : undefined, allowEdges);
            }
            return false;
        },

        // Resizes the panel based on mouse dragging.
        // Params:
        //    edges     A list of edges being moved.
        //    mouse     The current mouse position.
        __resize: function (edges, mouse) {
            var width = this.$container.width();
            var height = this.$container.height();
            var offset = this.$container.offset();

            mouse.x -= offset.left;
            mouse.y -= offset.top;

            var minSize = this.minSize();
            var maxSize = this.maxSize();

            var pos = {
                x: (this._pos.x * width) - this._size.x / 2,
                y: (this._pos.y * height) - this._size.y / 2
            };

            for (var i = 0; i < edges.length; ++i) {
                switch (edges[i]) {
                    case 'top':
                        this._size.y += pos.y - mouse.y - 2;
                        pos.y = mouse.y + 2;
                        if (this._size.y < minSize.y) {
                            pos.y += this._size.y - minSize.y;
                            this._size.y = minSize.y;
                        }
                        if (this._size.y > maxSize.y) {
                            pos.y += this._size.y - maxSize.y;
                            this._size.y = maxSize.y;
                        }
                        break;
                    case 'bottom':
                        this._size.y = mouse.y - 4 - pos.y;
                        if (this._size.y < minSize.y) {
                            this._size.y = minSize.y;
                        }
                        if (this._size.y > maxSize.y) {
                            this._size.y = maxSize.y;
                        }
                        break;
                    case 'left':
                        this._size.x += pos.x - mouse.x - 2;
                        pos.x = mouse.x + 2;
                        if (this._size.x < minSize.x) {
                            pos.x += this._size.x - minSize.x;
                            this._size.x = minSize.x;
                        }
                        if (this._size.x > maxSize.x) {
                            pos.x += this._size.x - maxSize.x;
                            this._size.x = maxSize.x;
                        }
                        break;
                    case 'right':
                        this._size.x = mouse.x - 4 - pos.x;
                        if (this._size.x < minSize.x) {
                            this._size.x = minSize.x;
                        }
                        if (this._size.x > maxSize.x) {
                            this._size.x = maxSize.x;
                        }
                        break;
                }

                this._pos.x = (pos.x + this._size.x / 2) / width;
                this._pos.y = (pos.y + this._size.y / 2) / height;
            }
        },

        // Turn off or on a shadowing effect to signify this widget is being moved.
        // Params:
        //    enabled       Whether to enable __shadow mode.
        __shadow: function (enabled) {
            if (enabled) {
                if (!this.$shadower) {
                    this.$shadower = $('<div class="wcFrameShadower">');
                    this.$frame.append(this.$shadower);
                    this.$shadower.animate({
                        opacity: 0.5
                    }, 300);
                }
            } else {
                if (this.$shadower) {
                    var self = this;
                    this.$shadower.animate({
                        opacity: 0.0
                    }, 300)
                        .queue(function (next) {
                            self.$shadower.remove();
                            self.$shadower = null;
                            next();
                        });
                }
            }
        },

        // Retrieves the bounding rect for this frame.
        __rect: function () {
            if (this.isCollapser()) {
                return this._parent.__rect();
            }

            var offset = this.$frame.offset();
            var width = this.$frame.width();
            var height = this.$frame.height();

            return {
                x: offset.left,
                y: offset.top,
                w: width,
                h: height
            };
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;
            if (this.$container) {
                this.$container.append(this.$frame);
            } else {
                this.$frame.remove();
            }
            return this.$container;
        },

        // Disconnects and prepares this widget for destruction.
        __destroy: function () {
            this._curTab = -1;
            for (var i = 0; i < this._panelList.length; ++i) {
                this._panelList[i].__destroy();
            }

            while (this._panelList.length) this._panelList.pop();
            if (this.$modalBlocker) {
                this.$modalBlocker.remove();
                this.$modalBlocker = null;
            }
            this.__container(null);
            this._parent = null;
        }
    });

    // window['wcFrame'] = Module;

    return Module;
});


/** @module wcDrawer */
define('wcDocker/drawer',[
    "dcl/dcl",
    "./types",
    "./frame",
    "./base"
], function (dcl, wcDocker, wcFrame, base) {
    /**
     * A docker container for carrying its own arrangement of docked panels as a slide out drawer.
     * @class module:wcDrawer
     * A collapsable container for carrying panels.<br>
     *
     * @version 3.0.0
     * @description <b><i>PRIVATE<i> - Handled internally by [docker]{@link module:wcDocker} and <u>should never be constructed by the user.</u></b>
     */
    var Module = dcl(base,{
        declaredClass: 'wcDrawer',

        /**
         * @memberOf module:wcDrawer
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this drawer.
         * @param {wcSplitter|wcDocker} parent - The drawer's parent object.
         * @param {module:wcDocker.DOCK} position - A docking position to place this drawer.
         */
        constructor:function (container, parent, position) {
            this.$container = $(container);
            this.$frame = null;

            this._position = position;
            this._parent = parent;
            this._frame = null;
            this._closeSize = 0;
            this._expanded = false;
            this._sliding = false;
            this._orientation = (this._position === wcDocker.DOCK.LEFT || this._position === wcDocker.DOCK.RIGHT) ? wcDocker.ORIENTATION.HORIZONTAL : wcDocker.ORIENTATION.VERTICAL;

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Collapses the drawer to its respective side wall.
         * @function module:wcDrawer#collapse
         */
        collapse: function (instant) {
            if (this._expanded) {
                // Collapse happens before the tab is de-selected, so record the
                // current size and assign it to the current panel.
                var panel = this._frame.panel();
                if (panel) {
                    var size = this._parent.pos();
                    if (this._position !== wcDocker.DOCK.LEFT) {
                        size = 1.0 - size;
                    }

                    var max;
                    if (this._position === wcDocker.DOCK.BOTTOM) {
                        max = this.docker().$container.height();
                        panel._size.y = size * max;
                    } else {
                        max = this.docker().$container.width();
                        panel._size.x = size * max;
                    }
                }

                this._expanded = false;
                if (instant) {
                    switch (this._position) {
                        case wcDocker.DOCK.TOP:
                        case wcDocker.DOCK.LEFT:
                            this._parent.pos(0);
                            break;
                        case wcDocker.DOCK.RIGHT:
                        case wcDocker.DOCK.BOTTOM:
                            this._parent.pos(1);
                            break;
                    }
                } else {
                    this._sliding = true;

                    var self = this;
                    var fin = function () {
                        self._sliding = false;
                        self._parent.__update();
                    };

                    switch (this._position) {
                        case wcDocker.DOCK.TOP:
                        case wcDocker.DOCK.LEFT:
                            this._parent.animPos(0, fin);
                            break;
                        case wcDocker.DOCK.RIGHT:
                        case wcDocker.DOCK.BOTTOM:
                            this._parent.animPos(1, fin);
                            break;
                    }
                }
            }
        },

        /**
         * Expands the drawer.
         * @function module:wcDrawer#expand
         */
        expand: function () {
            if (!this._expanded) {
                this._expanded = true;
                this._sliding = true;

                var panel = this._frame.panel();
                if (panel) {
                    // Determine the size to expand the drawer based on the size of the panel.
                    var size, max;
                    if (this._position === wcDocker.DOCK.BOTTOM) {
                        size = panel._size.y;
                        max = this.docker().$container.height();
                    } else {
                        size = panel._size.x;
                        max = this.docker().$container.width();
                    }

                    if (this._position !== wcDocker.DOCK.LEFT) {
                        size = max - size;
                    }

                    size = size / max;
                    var self = this;
                    this._parent.animPos(size, function () {
                        self._sliding = false;
                        self._parent.__update();
                    });
                }
            }
        },

        /**
         * Gets whether the drawer is expanded.
         * @function module:wcDrawer#isExpanded
         * @returns {Boolean} - The current expanded state.
         */
        isExpanded: function () {
            return this._expanded;
        },

        /**
         * The minimum size constraint for the drawer area.
         * @function module:wcDrawer#minSize
         * @returns {module:wcDocker~Size} - The minimum size.
         */
        minSize: function () {
            if (this._expanded) {
                if (this._root && typeof this._root.minSize === 'function') {
                    return this._root.minSize();
                } else {
                    return {x: 100, y: 100};
                }
            }
            this.__adjustCollapsedSize();
            return {x: this._closeSize, y: this._closeSize};
        },

        /**
         * The maximum size constraint for the drawer area.
         * @function module:wcDrawer#maxSize
         * @returns {module:wcDocker~Size} - The maximum size.
         */
        maxSize: function () {
            var isHorizontal = (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) ? true : false;
            if (this._expanded || this._sliding) {
                if (this._root && typeof this._root.maxSize === 'function') {
                    return {
                        x: (isHorizontal ? this._root.maxSize().x : Infinity),
                        y: (!isHorizontal ? this._root.maxSize().y : Infinity)
                    };
                } else {
                    return {x: Infinity, y: Infinity};
                }
            }
            this.__adjustCollapsedSize();
            return {
                x: (isHorizontal ? this._closeSize : Infinity),
                y: (!isHorizontal ? this._closeSize : Infinity)
            };
        },

///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        __init: function () {
            this.$frame = $('<div class="wcCollapserFrame">');
            this.__container(this.$container);

            this._frame = new (this.docker().__getClass('wcFrame'))(this.$frame, this, false);
            this._frame.tabOrientation(this._position);
        },

        // Updates the size of the collapser.
        __update: function (opt_dontMove) {
            this.__adjustCollapsedSize();
            this._frame.__update();
        },

        // Adjusts the size of the collapser when it is closed.
        __adjustCollapsedSize: function () {
            if (this._frame._panelList.length) {
                this._closeSize = this._frame.$tabBar.outerHeight();
                this._parent.$bar.removeClass('wcSplitterHidden');
            } else {
                this._closeSize = 0;
                this._parent.$bar.addClass('wcSplitterHidden');
            }
        },

        // Retrieves the bounding rect for this collapser.
        __rect: function () {
            var offset = this.$frame.offset();
            var width = this.$frame.width();
            var height = this.$frame.height();

            var panel = this._frame.panel();
            if (panel) {
                // Determine the size to expand the drawer based on the size of the panel.
                if (this._position === wcDocker.DOCK.BOTTOM) {
                    height = panel._size.y;
                    width = width / 3;
                } else {
                    width = panel._size.x;
                    height = height / 3;
                }
            }

            return {
                x: offset.left,
                y: offset.top,
                w: width,
                h: height
            };
        },

        // Saves the current panel configuration into a meta
        // object that can be used later to restore it.
        __save: function () {

            var data = {};
            data.closeSize = this._closeSize;
            data.frame = this._frame.__save();
            return data;
        },

        // Restores a previously saved configuration.
        __restore: function (data, docker) {
            this._closeSize = data.closeSize;
            this._frame.__restore(data.frame, docker);
            this.__adjustCollapsedSize();
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;
            if (this.$container) {
                this.$container.append(this.$frame);
            } else {
                this.$frame.remove();
            }
            return this.$container;
        },

        // Disconnects and prepares this widget for destruction.
        __destroy: function () {
            if (this._frame) {
                this._frame.__destroy();
                this._frame = null;
            }

            this.__container(null);
            this._parent = null;
        }
    });

    return Module;
});
/** @module wcCollapser */
define('wcDocker/collapser',[
    "dcl/dcl",
    "./types",
    "./splitter",
    "./drawer",
    "./base"
], function (dcl, wcDocker, wcSplitter, wcDrawer, base) {

    /**
     * A collapsable container for carrying panels.<br>
     *
     * @class module:wcCollapser
     * @version 3.0.0
     * @description A docker container for carrying its own arrangement of docked panels as a slide out drawer.<br/>
     * <b><i>PRIVATE<i> - Handled internally by [docker]{@link module:wcDocker} and <u>should never be constructed by the user.</u></b>
     */
    var Module = dcl(base, {
        declaredClass:'wcCollapser',
        /**
         * @memberOf module:wcCollapser
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this drawer.
         * @param {module:wcSplitter|wcDocker} parent  - The drawer's parent object.
         * @param {module:wcDocker.DOCK} position      - A docking position to place this drawer.
         */
        constructor: function (container, parent, position) {

            this.$container = $(container);
            this.$frame = null;

            this._position = position;
            this._parent = parent;
            this._splitter = null;
            this._drawer = null;
            this._size = 0;
            this._orientation = (this._position === wcDocker.DOCK.LEFT || this._position === wcDocker.DOCK.RIGHT) ? wcDocker.ORIENTATION.HORIZONTAL : wcDocker.ORIENTATION.VERTICAL;

            this.__init();
        },
        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        /**
         * Collapses the drawer to its respective side wall.
         * @function module:wcCollapser#collapse
         */
        collapse: function (instant) {
            this._drawer.collapse();
        },

        /**
         * Expands the drawer.
         * @function module:wcCollapser#expand
         */
        expand: function () {
            this._drawer.expand();
        },

        /**
         * Gets whether the drawer is expanded.
         * @function module:wcCollapser#isExpanded
         * @returns {Boolean} - The current expanded state.
         */
        isExpanded: function () {
            return this._drawer.isExpanded();
        },

        /**
         * The minimum size constraint for the side bar area.
         * @function module:wcCollapser#minSize
         * @returns {module:wcDocker~Size} - The minimum size.
         */
        minSize: function () {
            return {x: this._size, y: this._size};
        },

        /**
         * The maximum size constraint for the side bar area.
         * @function module:wcCollapser#maxSize
         * @returns {module:wcDocker~Size} - The maximum size.
         */
        maxSize: function () {
            var isHorizontal = (this._orientation === wcDocker.ORIENTATION.HORIZONTAL) ? true : false;
            return {
                x: (isHorizontal ? this._size : Infinity),
                y: (!isHorizontal ? this._size : Infinity)
            };
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Private Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        __init: function () {
            this.$frame = $('<div class="wcCollapserFrame">');
            this.__container(this.$container);

            var docker = this.docker();
            this._splitter = new (this.docker().__getClass('wcSplitter'))(docker.$container, this, this._orientation);
            this._drawer = new (this.docker().__getClass('wcDrawer'))(docker.$transition, this._splitter, this._position);
            switch (this._position) {
                case wcDocker.DOCK.LEFT:
                    this._splitter.pane(0, this._drawer);
                    this._splitter.$pane[1].remove();
                    this._splitter.$pane[0].addClass('wcDrawer');
                    this._splitter.pos(0);
                    break;
                case wcDocker.DOCK.RIGHT:
                case wcDocker.DOCK.BOTTOM:
                    this._splitter.pane(1, this._drawer);
                    this._splitter.$pane[0].remove();
                    this._splitter.$pane[1].addClass('wcDrawer');
                    this._splitter.pos(1);
                    break;
            }

            this._parent.$bar.addClass('wcSplitterHidden');
        },

        // Updates the size of the collapser.
        __update: function (opt_dontMove) {
            this._splitter.__update();
            this.__adjustSize();
        },

        // Adjusts the size of the collapser based on css
        __adjustSize: function () {
            if (this._drawer._frame._panelList.length) {
                this._size = this._drawer._frame.$tabBar.outerHeight();
            } else {
                this._size = 0;
            }
        },

        // Retrieves the bounding rect for this collapser.
        __rect: function () {
            return this._drawer.__rect();
        },

        // Saves the current panel configuration into a meta
        // object that can be used later to restore it.
        __save: function () {
            var data = {};
            data.size = this._size;
            data.drawer = this._drawer.__save();
            return data;
        },

        // Restores a previously saved configuration.
        __restore: function (data, docker) {
            this._size = data.size;
            this._drawer.__restore(data.drawer, docker);
            this.__adjustSize();
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;

            if (this.$container) {
                this.$container.append(this.$frame);
            } else {
                this.$frame.remove();
            }
            return this.$container;
        },

        // Disconnects and prepares this widget for destruction.
        __destroy: function () {
            if (this._splitter) {
                this._splitter.__destroy();
                this._splitter = null;
                this._frame = null;
            }

            this.__container(null);
            this._parent = null;
        }
    });

    return Module;

});

/** @module wcLayout */
define('wcDocker/layout',[
    "dcl/dcl",
    "./types"
], function (dcl, wcDocker) {

    /**
     * @class
     * The base class for all panel layouts. [Panels]{@link wcPanel}, [splitter widgets]{@link wcSplitter}
     * and [tab widgets]{@link wcTabFrame} contain these to organize their contents.
     */
    var Module = dcl(null, {
        declaredClass: 'wcLayout',

        /**
         * @memberOf module:wcLayout
         * <b><i>PRIVATE</i> - <u>This should never be constructed directly by the user</u></b>
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this layout.
         * @param {wcLayout|wcSplitter|wcDocker} parent - The layout's parent object.
         */
        constructor: function (container, parent) {
            /**
             * The outer container element of the panel.
             *
             * @member {external:jQuery~Object}
             */
            this.$container = $(container);
            this._parent = parent;

            /**
             * The table DOM element for the layout.
             *
             * @member {external:jQuery~Object}
             */
            this.$elem = null;

            this.__init();
        },

///////////////////////////////////////////////////////////////////////////////////////////////////////
// Public Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Adds an item into the layout, appending it to the main element.
         * @function module:wcLayout#addItem
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} item - A DOM element to add.
         */
        addItem: function (item) {
            // Should be implemented by a sub-class.
        },

        /**
         * Clears the contents of the layout and squashes all rows and columns from the grid.
         * @function module:wcLayout#clear
         */
        clear: function () {
            // Should be implemented by a sub-class.
        },

        /**
         * Retrieves the main element.
         * @function module:wcLayout#scene
         * @returns {external:jQuery~Object} - The div item that makes this layout scene.
         */
        scene: function () {
            return this.$elem;
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            // Should be implemented by a sub-class.
        },

        // Updates the size of the layout.
        __update: function () {
            // Should be implemented by a sub-class.
        },

        // Checks if the mouse is in a valid anchor position for nesting another widget.
        // Params:
        //    mouse                 The current mouse position.
        //    same                  Whether we are hovering over the same panel that is being moved.
        //    ghost                 An instance to the ghost object.
        //    canSplit              Whether the original panel can be split.
        //    $elem                 The container element for the target panel.
        //    title                 Whether the panel has a title bar visible.
        //    isTopper              Whether the item being dragged is the top title bar, as apposed to dragging a side or bottom tab/bar.
        //    forceTabOrientation   Force a specific tab orientation.
        //    allowEdges            Whether to allow edge docking.
        __checkAnchorDrop: function (mouse, same, ghost, canSplit, $elem, title, isTopper, forceTabOrientation, allowEdges) {
            var docker = this._parent.docker();
            var width = $elem.outerWidth();
            var height = $elem.outerHeight();
            var offset = $elem.offset();
            var titleSize = $elem.find('.wcFrameTitleBar').height();
            if (!title) {
                titleSize = 0;
            }

            function __getAnchorSizes(value, w, h) {
                if (typeof value === 'number' || (typeof value === 'string' && value.indexOf('px', value.length - 2) !== -1)) {
                    // Pixel sizing.
                    value = parseInt(value);
                    return {
                        x: value,
                        y: value
                    };
                } else if (typeof value === 'string' && value.indexOf('%', value.length - 1) !== -1) {
                    value = parseInt(value) / 100;
                    // Percentage sizing.
                    return {
                        x: w * value,
                        y: h * value
                    };
                } else {
                    // Invalid value.
                    return {x: 0, y: 0};
                }
            }

            var edgeAnchor = __getAnchorSizes(docker._options.edgeAnchorSize, docker.$container.outerWidth(), docker.$container.outerHeight());
            var panelAnchor = __getAnchorSizes(docker._options.panelAnchorSize, width, height);

            // If the target panel has a title, hovering over it (on all sides) will cause stacking
            // and also change the orientation of the tabs (if enabled).
            if (title && docker._options.allowTabs) {
                // Top title bar
                if ((!forceTabOrientation || forceTabOrientation === wcDocker.TAB.TOP) &&
                    mouse.y >= offset.top && mouse.y <= offset.top + titleSize &&
                    mouse.x >= offset.left && mouse.x <= offset.left + width) {

                    // Stacking with top orientation.
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top - 2,
                        w: width,
                        h: titleSize - 2,
                        loc: wcDocker.DOCK.STACKED,
                        tab: wcDocker.TAB.TOP,
                        item: this,
                        self: same === wcDocker.TAB.TOP || (isTopper && same)
                    });
                    return true;
                }
                // Any other tab orientation is only valid if tab orientation is enabled.
                else if (docker._canOrientTabs) {
                    // Bottom bar
                    if ((!forceTabOrientation || forceTabOrientation === wcDocker.TAB.BOTTOM) &&
                        mouse.y >= offset.top + height - titleSize && mouse.y <= offset.top + height &&
                        mouse.x >= offset.left && mouse.x <= offset.left + width) {

                        // Stacking with bottom orientation.
                        ghost.anchor(mouse, {
                            x: offset.left - 2,
                            y: offset.top + height - titleSize - 2,
                            w: width,
                            h: titleSize,
                            loc: wcDocker.DOCK.STACKED,
                            tab: wcDocker.TAB.BOTTOM,
                            item: this,
                            self: same === wcDocker.TAB.BOTTOM
                        });
                        return true;
                    }
                    // Left bar
                    else if ((!forceTabOrientation || forceTabOrientation === wcDocker.TAB.LEFT) &&
                        mouse.y >= offset.top && mouse.y <= offset.top + height &&
                        mouse.x >= offset.left && mouse.x <= offset.left + titleSize) {

                        // Stacking with bottom orientation.
                        ghost.anchor(mouse, {
                            x: offset.left - 2,
                            y: offset.top - 2,
                            w: titleSize - 2,
                            h: height,
                            loc: wcDocker.DOCK.STACKED,
                            tab: wcDocker.TAB.LEFT,
                            item: this,
                            self: same === wcDocker.TAB.LEFT
                        });
                        return true;
                    }
                    // Right bar
                    else if ((!forceTabOrientation || forceTabOrientation === wcDocker.TAB.RIGHT) &&
                        mouse.y >= offset.top && mouse.y <= offset.top + height &&
                        mouse.x >= offset.left + width - titleSize && mouse.x <= offset.left + width) {

                        // Stacking with bottom orientation.
                        ghost.anchor(mouse, {
                            x: offset.left + width - titleSize - 2,
                            y: offset.top - 2,
                            w: titleSize,
                            h: height,
                            loc: wcDocker.DOCK.STACKED,
                            tab: wcDocker.TAB.RIGHT,
                            item: this,
                            self: same === wcDocker.TAB.RIGHT
                        });
                        return true;
                    }
                }
            }

            // Test for edge anchoring.
            if (allowEdges && ghost._outer && ghost._inner) {
                var outerWidth = ghost._outer.$container.outerWidth();
                var outerHeight = ghost._outer.$container.outerHeight();
                var outerOffset = ghost._outer.$container.offset();

                // Left edge
                if (mouse.y >= outerOffset.top && mouse.y <= outerOffset.top + outerHeight &&
                    mouse.x >= outerOffset.left + titleSize && mouse.x <= outerOffset.left + titleSize + edgeAnchor.x) {
                    ghost.anchor(mouse, {
                        x: outerOffset.left - 2,
                        y: outerOffset.top - 2,
                        w: outerWidth / 3,
                        h: outerHeight,
                        loc: wcDocker.DOCK.LEFT,
                        item: ghost._inner,
                        self: false
                    });
                    return true;
                }
                // Right edge
                else if (mouse.y >= outerOffset.top && mouse.y <= outerOffset.top + outerHeight &&
                    mouse.x >= outerOffset.left + outerWidth - edgeAnchor.x - titleSize && mouse.x <= outerOffset.left + outerWidth - titleSize) {
                    ghost.anchor(mouse, {
                        x: outerOffset.left + outerWidth - (outerWidth / 3) - 2,
                        y: outerOffset.top - 2,
                        w: outerWidth / 3,
                        h: outerHeight,
                        loc: wcDocker.DOCK.RIGHT,
                        item: ghost._inner,
                        self: false
                    });
                    return true;
                }
                // Top edge
                else if (mouse.y >= outerOffset.top + titleSize && mouse.y <= outerOffset.top + titleSize + edgeAnchor.y &&
                    mouse.x >= outerOffset.left && mouse.x <= outerOffset.left + outerWidth) {
                    ghost.anchor(mouse, {
                        x: outerOffset.left - 2,
                        y: outerOffset.top - 2,
                        w: outerWidth,
                        h: outerHeight / 3,
                        loc: wcDocker.DOCK.TOP,
                        item: ghost._inner,
                        self: false
                    });
                    return true;
                }
                // Bottom edge
                else if (mouse.y >= outerOffset.top + outerHeight - titleSize - edgeAnchor.y && mouse.y <= outerOffset.top + outerHeight - titleSize &&
                    mouse.x >= outerOffset.left && mouse.x <= outerOffset.left + outerWidth) {
                    ghost.anchor(mouse, {
                        x: outerOffset.left - 2,
                        y: outerOffset.top + outerHeight - (outerHeight / 3) - 2,
                        w: outerWidth,
                        h: outerHeight / 3,
                        loc: wcDocker.DOCK.BOTTOM,
                        item: ghost._inner,
                        self: false
                    });
                    return true;
                }
            }

            if (!canSplit) {
                return false;
            }

            // Check for placeholder.
            if (this._parent && this._parent.instanceOf('wcPanel') && this._parent._isPlaceholder) {
                ghost.anchor(mouse, {
                    x: offset.left - 2,
                    y: offset.top - 2,
                    w: width,
                    h: height,
                    loc: wcDocker.DOCK.TOP,
                    item: this,
                    self: false
                });
                return true;
            }

            if (width < height) {
                // Top docking.
                if (mouse.y >= offset.top && mouse.y <= offset.top + titleSize + panelAnchor.y &&
                    mouse.x >= offset.left && mouse.x <= offset.left + width) {
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top - 2,
                        w: width,
                        h: height * 0.5,
                        loc: wcDocker.DOCK.TOP,
                        item: this,
                        self: false
                    });
                    return true;
                }

                // Bottom side docking.
                if (mouse.y >= offset.top + height - panelAnchor.y - titleSize && mouse.y <= offset.top + height &&
                    mouse.x >= offset.left && mouse.x <= offset.left + width) {
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top + (height - height * 0.5) - 2,
                        w: width,
                        h: height * 0.5,
                        loc: wcDocker.DOCK.BOTTOM,
                        item: this,
                        self: false
                    });
                    return true;
                }
            }

            // Left side docking
            if (mouse.y >= offset.top && mouse.y <= offset.top + height) {
                if (mouse.x >= offset.left && mouse.x <= offset.left + panelAnchor.x + titleSize) {
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top - 2,
                        w: width * 0.5,
                        h: height,
                        loc: wcDocker.DOCK.LEFT,
                        item: this,
                        self: false
                    });
                    return true;
                }

                // Right side docking
                if (mouse.x >= offset.left + width - panelAnchor.x - titleSize && mouse.x <= offset.left + width) {
                    ghost.anchor(mouse, {
                        x: offset.left + width * 0.5 - 2,
                        y: offset.top - 2,
                        w: width * 0.5,
                        h: height,
                        loc: wcDocker.DOCK.RIGHT,
                        item: this,
                        self: false
                    });
                    return true;
                }
            }

            if (width >= height) {
                // Top docking.
                if (mouse.y >= offset.top && mouse.y <= offset.top + panelAnchor.y + titleSize &&
                    mouse.x >= offset.left && mouse.x <= offset.left + width) {
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top - 2,
                        w: width,
                        h: height * 0.5,
                        loc: wcDocker.DOCK.TOP,
                        item: this,
                        self: false
                    });
                    return true;
                }

                // Bottom side docking.
                if (mouse.y >= offset.top + height - panelAnchor.y - titleSize && mouse.y <= offset.top + height &&
                    mouse.x >= offset.left && mouse.x <= offset.left + width) {
                    ghost.anchor(mouse, {
                        x: offset.left - 2,
                        y: offset.top + (height - height * 0.5) - 2,
                        w: width,
                        h: height * 0.5,
                        loc: wcDocker.DOCK.BOTTOM,
                        item: this,
                        self: false
                    });
                    return true;
                }
            }
            return false;
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;
            if (this.$container) {
                this.$container.append(this.$elem);
            } else {
                this.$elem.remove();
            }
            return this.$container;
        },

        // Destroys the layout.
        __destroy: function () {
            this.__container(null);
            this._parent = null;
            this.clear();

            this.$elem.remove();
            this.$elem = null;
        }
    });

    return Module;
});


/** @module wcLayoutSimple */
define('wcDocker/layoutsimple',[
    "dcl/dcl",
    "./types",
    "./layout"
], function (dcl, wcDocker, wcLayout) {

    /**
     * @class
     * A simple layout for containing elements in a panel. [Panels]{@link wcPanel}, [splitter widgets]{@link wcSplitter}
     * and [tab widgets]{@link wcTabFrame} can optionally contain these instead of the default {@link wcLayoutTable}.
     */
    var Module = dcl(wcLayout, {
        declaredClass: 'wcLayoutSimple',

///////////////////////////////////////////////////////////////////////////////////////////////////////
// Public Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Adds an item into the layout, appending it to the main element.
         * @function module:wcLayoutSimple#addItem
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} item - A DOM element to add.
         */
        addItem: function (item) {
            this.$elem.append(item);
        },

        /**
         * Clears the contents of the layout and squashes all rows and columns from the grid.
         * @function module:wcLayoutSimple#clear
         */
        clear: function () {
            this.$elem.remove();
            this.$elem = null;
            this.__init();
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            this.$elem = $('<div class="wcLayout wcWide wcTall"></div>');
            this.__container(this.$container);
        },

        // Updates the size of the layout.
        __update: function () {
        },
    });

    return Module;
});


/** @module wcLayoutTable */
define('wcDocker/layouttable',[
    "dcl/dcl",
    "./types",
    "./layout"
], function (dcl, wcDocker, wcLayout) {

    /**
     * @class module:wcLayoutTable
     * A gridded layout for arranging elements. [Panels]{@link wcPanel}, [splitter widgets]{@link wcSplitter}
     * and [tab widgets]{@link wcTabFrame} contain these by default to handle their contents.
     */
    var Module = dcl(wcLayout, {
        declaredClass: 'wcLayoutTable',

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Adds an item into the layout, expanding the grid size if necessary.
         * @function module:wcLayoutTable#addItem
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} item - A DOM element to add.
         * @param {Number} [x=0] - The horizontal grid position to place the element.
         * @param {Number} [y=0] - The vertical grid position to place the element.
         * @param {Number} [w=1] - The number of horizontal cells this item will take within the grid.
         * @param {Number} [h=1] - The number of vertical cells this item will take within the grid.
         * @returns {module:wcLayoutTable~tableItem|Boolean} The table data element of the cell that contains the item, or false if there was a problem.
         */
        addItem: function (item, x, y, w, h) {
            if (typeof x === 'undefined' || x < 0) {
                x = 0;
            }
            if (typeof y === 'undefined' || y < 0) {
                y = 0;
            }
            if (typeof w === 'undefined' || w <= 0) {
                w = 1;
            }
            if (typeof h === 'undefined' || h <= 0) {
                h = 1;
            }

            this.__resizeGrid(x + w - 1, y + h - 1);
            if (w > 1 || h > 1) {
                if (!this.__mergeGrid(x, y, w, h)) {
                    return false;
                }
            }

            this._grid[y][x].$el.append($(item));
            return this.item(x, y);
        },

        /**
         * Retrieves the table item at a given grid position, if it exists.
         * Note, if an item spans multiple cells, only the top-left most
         * cell will actually contain the table item.
         * @function module:wcLayoutTable#item
         * @param {Number} x - The horizontal grid position.
         * @param {Number} y - The vertical grid position.
         * @returns {module:wcLayoutTable~tableItem|Boolean} - The table item, or false if none was found.
         */
        item: function (x, y) {
            if (y >= this._grid.length) {
                return false;
            }

            if (x >= this._grid[y].length) {
                return false;
            }

            // Some cells are a merging of multiple cells. If this cell is
            // part of a merge for another cell, use that cell instead.
            // if (this._grid[y][x].x < 0 || this._grid[y][x].y < 0) {
            //   var grid = this._grid[y][x];
            //   x -= grid.x;
            //   y -= grid.y;
            // }

            var self = this;
            /**
             * The table item is an object that represents one cell in the layout table, it contains
             * convenient methods for cell alteration and supports chaining. Its purpose is
             * to remove the need to alter &lt;tr&gt; and &lt;td&gt; elements of the table directly.
             * @version 3.0.0
             * @example myPanel.addItem(domNode).css('text-align', 'right').css('border', '1px solid black').stretch('100%', '100%');
             * @typedef module:wcLayoutTable#tableItem
             * @property {jQuery~Object} $ - If you truely need the table cell [jQuery object]{@link jQuery~Object}, here it is.
             * @property {module:wcLayoutTable~tableItem_css} css - Wrapper to alter [jQuery's css]{@link http://api.jquery.com/css/} function.
             * @property {module:wcLayoutTable~tableItem_stretch} stretch - More reliable method for setting the table item width/height values.
             */
            var myItem = {
                $: self._grid[y][x].$el,

                /**
                 * <small><i>This function is found in {@link module:wcLayoutTable~tableItem}.</small></i><br>
                 * A wrapper for [jQuery's css]{@link http://api.jquery.com/css/} function.
                 * <b>Note:</b> It is recommended that you use [stretch]{@link wcLayoutTable~stretch} if you intend to alter width or height styles.
                 * @version 3.0.0
                 * @function module:wcLayoutTable#tableItem_css
                 * @param {String} style - The style attribute to alter.
                 * @param {String} [value] - The value of the attribute. If omitted, the current value of the attribute is returned instead of the [tableItem]{@link module:wcLayoutTable~tableItem} instance.
                 * @returns {module:wcLayoutTable~tableItem|String} - Self, for chaining, unless the value parameter was omitted.
                 */
                css: function (style, value) {
                    if (self._grid[y][x].$el) {
                        if (value === undefined) {
                            return self._grid[y][x].$el.css(style);
                        }

                        self._grid[y][x].$el.css(style, value);
                    }
                    return myItem;
                },

                /**
                 * <small><i>This function is found in {@link module:wcLayoutTable~tableItem}.</small></i><br>
                 * Sets the stretch amount for the current table item. This is more reliable than
                 * assigning width and height style attributes directly on the table item.
                 * @version 3.0.0
                 * @function module:wcLayoutTable#tableItem_stretch
                 * @param {Number|String} [sx] - The horizontal stretch for this grid. Use empty string to clear current value. Can be a pixel position, or a string with a 'px' or '%' suffix.
                 * @param {Number|String} [sy] - The vertical stretch for this grid. Use empty string to clear current value. Can be a pixel position, or a string with a 'px' or '%' suffix.
                 * @returns {module:wcLayoutTable~tableItem} - Self, for chaining.
                 */
                stretch: function (width, height) {
                    self.itemStretch(x, y, width, height);
                    return myItem;
                }
            };
            return myItem;
        },

        /**
         * Sets the stretch amount for a given table item. This is more reliable than
         * assigning width and height style attributes directly on the table item.
         * @version 3.0.0
         * @function module:wcLayoutTable#itemStretch
         * @param {Number} x - The horizontal grid position.
         * @param {Number} y - The vertical grid position.
         * @param {Number|String} [sx] - The horizontal stretch for this grid. Use empty string to clear current value. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @param {Number|String} [sy] - The vertical stretch for this grid. Use empty string to clear current value. Can be a pixel position, or a string with a 'px' or '%' suffix.
         * @returns {Boolean} - Success or failure. A failure generally means your grid position was a merged grid cell.
         */
        itemStretch: function (x, y, sx, sy) {
            var wasBatched = this._batchProcess;

            this._batchProcess = true;
            this.__resizeGrid(x, y);

            var grid = this._grid[y][x];
            if (grid.x < 0 || grid.y < 0) {
                return false;
            }

            if (sx !== undefined) {
                grid.sx = sx;
            }
            if (sy !== undefined) {
                grid.sy = sy;
            }

            this._batchProcess = wasBatched;
            if (!wasBatched) {
                this.__resizeGrid(0, 0);
            }

            return true;
        },

        /**
         * Clears the contents of the layout and squashes all rows and columns from the grid.
         * @function module:wcLayoutTable#clear
         */
        clear: function () {
            var showGrid = this.showGrid();
            var spacing = this.gridSpacing();
            var alternate = this.gridAlternate();

            this.$elem.remove();
            this.__init();

            this.showGrid(showGrid);
            this.gridSpacing(spacing);
            this.gridAlternate(alternate);

            this._grid = [];
        },

        /**
         * Begins a batch operation.  Basically it refrains from constructing
         * the layout grid, which causes a reflow, on each item added.  Instead,
         * The grid is only generated at the end once [wcLayoutTable.finishBatch]{@link wcLayoutTable#finishBatch} is called.
         * @function module:wcLayoutTable#startBatch
         */
        startBatch: function () {
            this._batchProcess = true;
        },

        /**
         * Ends a batch operation.
         * @See module:wcLayoutTable#startBatch
         * @function module:wcLayoutTable#finishBatch
         */
        finishBatch: function () {
            this._batchProcess = false;
            this.__resizeGrid(0, 0);
        },

        /**
         * Gets, or Sets whether the layout grid cells should draw an outline.
         * @function module:wcLayoutTable#showGrid
         * @param {Boolean} [enabled] - If supplied, will set the grid cell border visibility.
         * @returns {Boolean} - The current visibility state of the grid cells.
         */
        showGrid: function (enabled) {
            if (typeof enabled !== 'undefined') {
                this.$elem.toggleClass('wcLayoutGrid', enabled);
            }

            return this.$elem.hasClass('wcLayoutGrid');
        },

        /**
         * Gets, or Sets the spacing between cell borders.
         * @function module:wcLayoutTable#gridSpacing
         * @param {Number} [size] - If supplied, sets the pixel size of the spacing between cells.
         * @returns {Number} - The current cell spacing in pixels.
         */
        gridSpacing: function (size) {
            if (typeof size !== 'undefined') {
                this.$elem.css('border-spacing', size + 'px');
            }

            return parseInt(this.$elem.css('border-spacing'));
        },

        /**
         * Gets, or Sets whether the table rows alternate in color based on the theme.
         * @function module:wcLayoutTable#gridAlternate
         * @params {Boolean} [enabled] - If supplied, will set whether the grid alternates in color.
         * @returns {Boolean} - Whether the grid alternates in color.
         */
        gridAlternate: function (enabled) {
            if (typeof enabled !== 'undefined') {
                this.$elem.toggleClass('wcLayoutGridAlternate', enabled);
            }

            return this.$elem.hasClass('wcLayoutGridAlternate');
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            this.$elem = $('<table class="wcLayout wcWide wcTall"></table>');
            this.$elem.append($('<tbody></tbody>'));
            this._grid = [];
            this.__container(this.$container);
        },

        // Updates the size of the layout.
        __update: function () {
        },

        // Resizes the grid to fit a given position.
        // Params:
        //    width     The width to expand to.
        //    height    The height to expand to.
        __resizeGrid: function (width, height) {
            for (var y = 0; y <= height; ++y) {
                if (this._grid.length <= y) {
                    var row = [];
                    row.$row = $('<tr>');
                    this._grid.push(row);
                }

                for (var x = 0; x <= width; ++x) {
                    if (this._grid[y].length <= x) {
                        this._grid[y].push({
                            $el: $('<td>'),
                            x: 0,
                            y: 0,
                            sx: '',
                            sy: ''
                        });
                    }
                }
            }

            if (!this._batchProcess) {
                var $oldBody = this.$elem.find('tbody');
                $('.wcDockerTransition').append($oldBody);

                var $newBody = $('<tbody>');
                for (var y = 0; y < this._grid.length; ++y) {
                    var $row = null;

                    for (var x = 0; x < this._grid[y].length; ++x) {
                        var item = this._grid[y][x];
                        if (item.$el) {
                            if (!$row) {
                                $row = this._grid[y].$row;
                                $newBody.append($row);
                            }

                            item.$el.css('width', item.sx);
                            item.$el.css('height', item.sy);
                            $row.append(item.$el);
                        }
                    }
                }

                this.$elem.append($newBody);
                $oldBody.remove();
            }
        },

        // Merges cells in the layout.
        // Params:
        //    x, y      Cell position to begin merge.
        //    w, h      The width and height to merge.
        // Returns:
        //    true      Cells were merged succesfully.
        //    false     Merge failed, either because the grid position was out of bounds
        //              or some of the cells were already merged.
        __mergeGrid: function (x, y, w, h) {
            // Make sure each cell to be merged is not already merged somewhere else.
            for (var yy = 0; yy < h; ++yy) {
                for (var xx = 0; xx < w; ++xx) {
                    var item = this._grid[y + yy][x + xx];
                    if (!item.$el || item.x !== 0 || item.y !== 0) {
                        return false;
                    }
                }
            }

            // Now merge the cells here.
            var item = this._grid[y][x];
            if (w > 1) {
                item.$el.attr('colspan', '' + w);
                item.x = w - 1;
            }
            if (h > 1) {
                item.$el.attr('rowspan', '' + h);
                item.y = h - 1;
            }

            for (var yy = 0; yy < h; ++yy) {
                for (var xx = 0; xx < w; ++xx) {
                    if (yy !== 0 || xx !== 0) {
                        var item = this._grid[y + yy][x + xx];
                        item.$el.remove();
                        item.$el = null;
                        item.x = -xx;
                        item.y = -yy;
                    }
                }
            }
            return true;
        },
    });

    return Module;
});

/** @module wcTabFrame */
define('wcDocker/tabframe',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class
     * A tab widget container, usable inside a panel to break up multiple elements into separate tabbed pages.
     */
    var Module = dcl(base, {
        declaredClass: 'wcTabFrame',

        LEFT_TAB_BUFFER: 15,

        /**
         * @memberOf module:wcTabFrame
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this layout.
         * @param {module:wcPanel} parent - The parent panel object for this widget.
         */
        constructor: function(container, parent) {
            /**
             * The outer container element of the widget.
             * @member {external:jQuery~Object}
             */
            this.$container = $(container);
            this._parent = parent;

            this.$frame = null;
            this.$tabBar = null;
            this.$tabScroll = null;
            this.$center = null;
            this.$tabLeft = null;
            this.$tabRight = null;
            this.$close = null;

            this._tabOrientation = wcDocker.TAB.TOP;
            this._canScrollTabs = false;
            this._tabScrollPos = 0;
            this._curTab = -1;
            this._layoutList = [];
            this._moveable = true;

            this._boundEvents = [];

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Manually update the contents of this tab frame.
         * @function module:wcTabFrame#update
         */
        update: function () {
            var scrollTop = this.$center.scrollTop();
            this.__updateTabs();
            this.$center.scrollTop(scrollTop);
        },

        /**
         * Destroys the widget.
         * @function module:wcTabFrame#destroy
         */
        destroy: function () {
            this.__destroy();
        },

        /**
         * Gets the total number of tabs in this frame.
         * @version 3.0.0
         * @function module:wcTabFrame#tabCount
         * @returns {Number}
         */
        tabCount: function () {
            return this._layoutList.length;
        },

        /**
         * Gets, or Sets the tab orientation for the frame. This puts the tabbed widgets visually on any side of the tab frame.
         * @version 3.0.0
         * @function module:wcTabFrame#tabOrientation
         * @param {module:wcDocker.TAB} [orientation] - Assigns the orientation of the tab items displayed.
         * @returns {module:wcDocker.TAB} - The current orientation.
         */
        tabOrientation: function (orientation) {
            if (orientation !== undefined) {
                if (this._tabOrientation !== orientation && this.docker()._canOrientTabs) {
                    this._tabOrientation = orientation;

                    this.__updateTabs();
                    this.__updateTabs();
                }
            }

            return this._tabOrientation
        },

        /**
         * Adds a new tabbed page into the widget.
         * @function module:wcTabFrame#addTab
         * @param {String} name - The name of the new tab page.
         * @param {Number} [index] - If supplied and above -1, will insert the new tab page at the given tab index, otherwise the new tab is appended to the end.
         * @param {module:wcDocker.LAYOUT} [layout] - If supplied, will set the type of layout to use for this tab.
         * @returns {module:wcLayoutSimple|wcLayoutTable} - The layout of the newly created tab page.
         */
        addTab: function (name, index, layout) {
            var layoutClass = layout || 'wcLayoutTable';
            var newLayout = new (this.docker().__getClass(layoutClass))('.wcDockerTransition', this._parent);
            newLayout.name = name;
            newLayout._scrollable = {
                x: true,
                y: true
            };
            newLayout._scroll = {
                x: 0,
                y: 0
            };
            newLayout._closeable = false;
            newLayout._overflowVisible = false;

            if (typeof index === 'undefined' || index <= -1) {
                this._layoutList.push(newLayout);
            } else {
                this._layoutList.splice(index, 0, newLayout);
            }

            if (this._curTab === -1 && this._layoutList.length) {
                this._curTab = 0;
            }

            this.__updateTabs();

            return newLayout;
        },

        /**
         * Removes a tab page from the widget.
         * @function module:wcTabFrame#removeTab
         * @param {Number} index - The tab page index to remove.
         * @returns {Boolean} - Success or failure.
         */
        removeTab: function (index) {
            if (index > -1 && index < this._layoutList.length) {
                var name = this._layoutList[index].name;
                this._layoutList[index].__destroy();
                this._layoutList.splice(index, 1);

                if (this._curTab >= index) {
                    this._curTab--;

                    if (this._curTab < 0) {
                        this._curTab = 0;
                    }
                }

                this.__updateTabs();
                this._parent.__trigger(wcDocker.EVENT.CUSTOM_TAB_CLOSED, {obj: this, name: name, index: index});
                return true;
            }
            return false;
        },

        /**
         * Gets, or Sets the currently visible tab page.
         * @function module:wcTabFrame#tab
         * @param {Number} [index] - If supplied, sets the current tab page index.
         * @param {Boolean} [scrollTo] - If true, will auto scroll the tab bar until the selected tab is visible.
         * @returns {Number} - The index of the currently visible tab page.
         */
        tab: function (index, scrollTo) {
            if (typeof index !== 'undefined') {
                if (index > -1 && index < this._layoutList.length) {
                    this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + this._curTab + '"]').removeClass('wcPanelTabActive');
                    this.$center.children('.wcPanelTabContent[id="' + this._curTab + '"]').addClass('wcPanelTabContentHidden');
                    this._curTab = index;
                    this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + index + '"]').addClass('wcPanelTabActive');
                    this.$center.children('.wcPanelTabContent[id="' + index + '"]').removeClass('wcPanelTabContentHidden');
                    this.__updateTabs(scrollTo);

                    var name = this._layoutList[this._curTab].name;
                    this._parent.__trigger(wcDocker.EVENT.CUSTOM_TAB_CHANGED, {obj: this, name: name, index: index});
                }
            }

            return this._curTab;
        },

        /**
         * Retrieves the layout for a given tab page.
         * @function module:wcTabFrame#layout
         * @param {Number} index - The tab page index to retrieve.
         * @returns {module:wcLayoutSimple|wcLayoutTable|Boolean} - The layout of the found tab page, or false.
         */
        layout: function (index) {
            if (index > -1 && index < this._layoutList.length) {
                return this._layoutList[index];
            }
            return false;
        },

        /**
         * Moves a tab page from a given index to another index.
         * @function module:wcTabFrame#moveTab
         * @param {Number} fromIndex - The current tab page index to move from.
         * @param {Number} toIndex - The new tab page index to move to.
         * @returns {external:jQuery~Object} - The new element of the moved tab, or false if an error occurred.
         */
        moveTab: function (fromIndex, toIndex) {
            if (fromIndex >= 0 && fromIndex < this._layoutList.length &&
                toIndex >= 0 && toIndex < this._layoutList.length) {
                var panel = this._layoutList.splice(fromIndex, 1);
                this._layoutList.splice(toIndex, 0, panel[0]);

                // Preserve the currently active tab.
                if (this._curTab === fromIndex) {
                    this._curTab = toIndex;
                }

                this.__updateTabs();

                return this.$tabBar.find('> .wcTabScroller > .wcPanelTab[id="' + toIndex + '"]')[0];
            }
            return false;
        },

        /**
         * Gets, or Sets whether the tabs can be reordered by the user.
         * @function module:wcTabFrame#moveable
         * @param {Boolean} [moveable] - If supplied, assigns whether tab pages can be reordered.
         * @returns {Boolean} - Whether tab pages are currently moveable.
         */
        moveable: function (moveable) {
            if (typeof moveable !== 'undefined') {
                this._moveable = moveable;
            }
            return this._moveable;
        },

        /**
         * Gets, or Sets whether a tab can be closed (removed) by the user.
         * @function module:wcTabFrame#closeable
         * @param {Number} index - The index of the tab page.
         * @param {Boolean} [closeable] - If supplied, assigns whether the tab page can be closed.
         * @returns {Boolean} - Whether the tab page can be closed.
         */
        closeable: function (index, closeable) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                if (typeof closeable !== 'undefined') {
                    layout._closeable = closeable;
                }

                return layout._closeable;
            }
            return false;
        },

        /**
         * Gets, or Sets whether a tab page area is scrollable.
         * @function module:wcTabFrame#scrollable
         * @param {Number} index - The index of the tab page.
         * @param {Boolean} [x] - If supplied, assigns whether the tab page is scrollable in the horizontal direction.
         * @param {Boolean} [y] - If supplied, assigns whether the tab page is scrollable in the vertical direction.
         * @returns {module:wcDocker~Scrollable} - The current scrollable status of the tab page.
         */
        scrollable: function (index, x, y) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                var changed = false;
                if (typeof x !== 'undefined') {
                    layout._scrollable.x = x;
                    changed = true;
                }
                if (typeof y !== 'undefined') {
                    layout._scrollable.y = y;
                    changed = true;
                }

                if (changed) {
                    this.__onTabChange();
                }

                return {
                    x: layout._scrollable.x,
                    y: layout._scrollable.y
                };
            }
            return false;
        },

        /**
         * Gets, or Sets whether overflow on a tab area is visible.<br>
         * Use this if a child element within this panel is intended to 'popup' and be visible outside of its parent area.
         * @function module:wcTabFrame#overflowVisible
         * @param {Number} index - The index of the tab page.
         * @param {Boolean} [visible] - If supplied, assigns whether overflow is visible.
         * @returns {Boolean} - The current overflow visiblity status of the tab page.
         */
        overflowVisible: function (index, visible) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                if (typeof overflow !== 'undefined') {
                    layout._overflowVisible = overflow;
                    this.__onTabChange();
                }
                return layout._overflowVisible;
            }
            return false;
        },

        /**
         * Gets, or Sets whether the tab frame should fit to its contents.
         * @version 3.0.0
         * @function module:wcTabFrame#fitContents
         * @param {Number} index - The index of the tab page.
         * @param {Boolean} [x] - If supplied, assigns whether the tab page is scrollable in the horizontal direction.
         * @param {Boolean} [y] - If supplied, assigns whether the tab page is scrollable in the vertical direction.
         * @returns {module:wcDocker~FitContents} - The current scrollable status of the tab page.
         */
        fitContents: function (index, x, y) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                if (!layout.hasOwnProperty('_fitContents')) {
                    layout._fitContents = {
                        x: false,
                        y: false
                    };
                }

                var changed = false;
                if (typeof x !== 'undefined') {
                    layout._fitContents.x = x;
                    changed = true;
                }
                if (typeof y !== 'undefined') {
                    layout._fitContents.y = y;
                    changed = true;
                }

                if (changed) {
                    this.__onTabChange();
                }

                return {
                    x: layout._fitContents.x,
                    y: layout._fitContents.y
                };
            }
            return false;
        },

        /**
         * Sets the icon for a tab item.
         * @function module:wcTabFrame#icon
         * @param {Number} index - The index of the tab item.
         * @param {String} icon - A CSS class name that represents the icon.
         */
        icon: function (index, icon) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                if (!layout.$icon) {
                    layout.$icon = $('<div>');
                }

                layout.$icon.removeClass();
                layout.$icon.addClass('wcTabIcon ' + icon);
            }
        },

        /**
         * Sets the icon for a tab item using the [Font-Awesome]{@link http://fortawesome.github.io/Font-Awesome/} library.
         * @function module:wcTabFrame#faicon
         * @param {Number} index - The index of the tab item.
         * @param {String} icon - A [Font-Awesome]{@link http://fortawesome.github.io/Font-Awesome/} icon name (without the 'fa fa-' prefix).
         */
        faicon: function (index, icon) {
            if (index > -1 && index < this._layoutList.length) {
                var layout = this._layoutList[index];

                if (!layout.$icon) {
                    layout.$icon = $('<div>');
                }

                layout.$icon.removeClass();
                layout.$icon.addClass('fa fa-fw fa-' + icon);
            }
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        // Initialize
        __init: function () {
            this.$frame = $('<div class="wcCustomTab wcWide wcTall">');
            this.$tabBar = $('<div class="wcFrameTitleBar wcCustomTabTitle wcWide">');
            this.$tabScroll = $('<div class="wcTabScroller">');
            this.$center = $('<div class="wcFrameCenter wcPanelBackground">');
            this.$tabLeft = $('<div class="wcFrameButton" title="Scroll tabs to the left."><span class="fa fa-arrow-left"></span>&lt;</div>');
            this.$tabRight = $('<div class="wcFrameButton" title="Scroll tabs to the right."><span class="fa fa-arrow-right"></span>&gt;</div>');
            this.$close = $('<div class="wcFrameButton" title="Remove panel"><span class="fa fa-close"></span>X</div>');

            //this.$maximize = $('<div class="wcFrameButton" title="Remove panel"><span class="fa fa-expand"></span>X</div>');
            this.$buttonBar = $('<div class="wcFrameButtonBar">');


            this.$tabBar.append(this.$tabScroll);
            this.$tabBar.append(this.$buttonBar);
            this.$buttonBar.append(this.$close);

            //this.$buttonBar.append(this.$maximize);

            this.$frame.append(this.$center);
            this.$frame.append(this.$tabBar);

            this.__container(this.$container);

            this._boundEvents.push({event: wcDocker.EVENT.UPDATED, handler: this.update.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.CLOSED, handler: this.destroy.bind(this)});

            for (var i = 0; i < this._boundEvents.length; ++i) {
                this._parent.on(this._boundEvents[i].event, this._boundEvents[i].handler);
            }

            var docker = this.docker();
            if (docker) {
                docker._tabList.push(this);
            }
        },

        __updateTabs: function (scrollTo) {
            this.$tabScroll.empty();

            var getOffset = function ($item) {
                switch (this._tabOrientation) {
                    case wcDocker.TAB.BOTTOM:
                        return $item.offset().left;
                    case wcDocker.TAB.TOP:
                        return $item.offset().left;
                    case wcDocker.TAB.LEFT:
                        return $item.offset().top;
                    case wcDocker.TAB.RIGHT:
                        return $item.offset().top;
                }
            }.bind(this);

            var tabPositions = [];
            var totalWidth = 0;
            var parentLeft = getOffset(this.$tabScroll);
            var self = this;

            this.$center.children('.wcPanelTabContent').each(function () {
                $(this).addClass('wcPanelTabContentHidden wcPanelTabUnused');
            });

            for (var i = 0; i < this._layoutList.length; ++i) {
                var $tab = $('<div id="' + i + '" class="wcPanelTab"><div>' + this._layoutList[i].name + '</div></div>');
                if (this._moveable) {
                    $tab.addClass('wcCustomTabMoveable');
                }
                this.$tabScroll.append($tab);
                if (this._layoutList[i].$icon) {
                    $tab.find('div').prepend(this._layoutList[i].$icon);
                }

                var $tabContent = this.$center.children('.wcPanelTabContent[id="' + i + '"]');
                if (!$tabContent.length) {
                    $tabContent = $('<div class="wcPanelTabContent wcPanelTabContentHidden" id="' + i + '">');
                    this.$center.append($tabContent);
                }

                this._layoutList[i].__container($tabContent);
                this._layoutList[i]._parent = this;

                var isVisible = this._curTab === i;

                $tabContent.removeClass('wcPanelTabUnused');

                if (isVisible) {
                    $tab.addClass('wcPanelTabActive');
                    $tabContent.removeClass('wcPanelTabContentHidden');
                }

                totalWidth = getOffset($tab) - parentLeft;
                tabPositions.push(totalWidth);

                totalWidth += $tab.outerWidth();
            }

            var tabWidth = 0;
            var titleSize = this.$tabBar.height();
            switch (this._tabOrientation) {
                case wcDocker.TAB.TOP:
                    this.$tabBar.addClass('wcTabTop').removeClass('wcTabLeft wcTabRight wcTabBottom');
                    this.$center.css('top', titleSize).css('left', 0).css('right', 0).css('bottom', 0);
                    tabWidth = this.$center.width();
                    break;
                case wcDocker.TAB.BOTTOM:
                    this.$tabBar.addClass('wcTabBottom').removeClass('wcTabTop wcTabLeft wcTabRight');
                    this.$center.css('top', 0).css('left', 0).css('right', 0).css('bottom', titleSize);
                    tabWidth = this.$center.width();
                    break;

                case wcDocker.TAB.LEFT:
                    this.$tabBar.addClass('wcTabLeft').removeClass('wcTabTop wcTabRight wcTabBottom');
                    this.$center.css('top', 0).css('left', titleSize).css('right', 0).css('bottom', 0);
                    tabWidth = this.$center.height();
                    break;

                case wcDocker.TAB.RIGHT:
                    this.$tabBar.addClass('wcTabRight').removeClass('wcTabTop wcTabLeft wcTabBottom');
                    this.$center.css('top', 0).css('left', 0).css('right', titleSize).css('bottom', 0);
                    tabWidth = this.$center.height();
                    break;
            }

            // Now remove all unused panel tabs.
            this.$center.children('.wcPanelTabUnused').each(function () {
                $(this).remove();
            });

            var buttonSize = this.__onTabChange();

            if (scrollTo) {
                for (var i = 0; i < tabPositions.length; ++i) {
                    if (i === this._curTab) {
                        var left = tabPositions[i];
                        var right = totalWidth;
                        if (i + 1 < tabPositions.length) {
                            right = tabPositions[i + 1];
                        }

                        var scrollPos = -parseInt(this.$tabScroll.css('left'));
                        var titleWidth = tabWidth - buttonSize;

                        // If the tab is behind the current scroll position.
                        if (left < scrollPos) {
                            this._tabScrollPos = left - this.LEFT_TAB_BUFFER;
                            if (this._tabScrollPos < 0) {
                                this._tabScrollPos = 0;
                            }
                        }
                        // If the tab is beyond the current scroll position.
                        else if (right - scrollPos > titleWidth) {
                            this._tabScrollPos = right - titleWidth + this.LEFT_TAB_BUFFER;
                        }
                        break;
                    }
                }
            }

            this._canScrollTabs = false;
            if (totalWidth > tabWidth - buttonSize) {
                this._canScrollTabs = true;
                this.$buttonBar.append(this.$tabRight);
                this.$buttonBar.append(this.$tabLeft);
                buttonSize += this.$tabRight.outerWidth();
                buttonSize += this.$tabLeft.outerWidth();

                var scrollLimit = totalWidth - (tabWidth - buttonSize) / 2;
                // If we are beyond our scroll limit, clamp it.
                if (this._tabScrollPos > scrollLimit) {
                    var children = this.$tabScroll.children();
                    for (var i = 0; i < children.length; ++i) {
                        var $tab = $(children[i]);

                        totalWidth = getOffset($tab) - parentLeft;
                        if (totalWidth + $tab.outerWidth() > scrollLimit) {
                            this._tabScrollPos = totalWidth - this.LEFT_TAB_BUFFER;
                            if (this._tabScrollPos < 0) {
                                this._tabScrollPos = 0;
                            }
                            break;
                        }
                    }
                }
            } else {
                this._tabScrollPos = 0;
                this.$tabLeft.remove();
                this.$tabRight.remove();
            }

            this.$tabScroll.stop().animate({left: -this._tabScrollPos + 'px'}, 'fast');
        },

        __onTabChange: function () {
            var buttonSize = 0;
            var layout = this.layout(this._curTab);
            if (layout) {
                this.$center.toggleClass('wcScrollableX', layout._scrollable.x);
                this.$center.toggleClass('wcScrollableY', layout._scrollable.y);
                this.$center.toggleClass('wcOverflowVisible', layout._overflowVisible);

                this.$tabLeft.remove();
                this.$tabRight.remove();

                if (layout._closeable) {
                    this.$close.show();
                    buttonSize += this.$close.outerWidth();
                } else {
                    this.$close.hide();
                }

                if (this._canScrollTabs) {
                    this.$tabBar.append(this.$tabRight);
                    this.$tabBar.append(this.$tabLeft);

                    buttonSize += this.$tabRight.outerWidth() + this.$tabLeft.outerWidth();
                }

                var fit = this.fitContents(this._curTab);
                if (fit.x) {
                    var w = layout.scene().outerWidth();
                    if (this._tabOrientation === wcDocker.TAB.LEFT || this._tabOrientation === wcDocker.TAB.RIGHT) {
                        w += this.$tabScroll.height();
                    }
                    this.$container.css('width', w);
                } else {
                    this.$container.css('width', '');
                }

                if (fit.y) {
                    var h = layout.scene().outerHeight();
                    if (this._tabOrientation === wcDocker.TAB.TOP || this._tabOrientation === wcDocker.TAB.BOTTOM) {
                        h += this.$tabScroll.height();
                    }
                    this.$container.css('height', h);
                } else {
                    this.$container.css('height', '');
                }

                switch (this._tabOrientation) {
                    case wcDocker.TAB.RIGHT:
                    case wcDocker.TAB.LEFT:
                        this.$tabBar.css('width', this.$center.height() || '100%');
                        break;
                    case wcDocker.TAB.TOP:
                    case wcDocker.TAB.BOTTOM:
                        this.$tabBar.css('width', this.$center.width() || '100%');
                    default:
                        break;
                }

                this.$center.scrollLeft(layout._scroll.x);
                this.$center.scrollTop(layout._scroll.y);
            }

            this.$buttonBar.css('min-width', buttonSize).css('width', buttonSize);
            return buttonSize;
        },

        // Handles scroll notifications.
        __scrolled: function () {
            var layout = this.layout(this._curTab);
            layout._scroll.x = this.$center.scrollLeft();
            layout._scroll.y = this.$center.scrollTop();
        },

        // Gets, or Sets a new container for this layout.
        // Params:
        //    $container          If supplied, sets a new container for this layout.
        //    parent              If supplied, sets a new parent for this layout.
        // Returns:
        //    JQuery collection   The current container.
        __container: function ($container) {
            if (typeof $container === 'undefined') {
                return this.$container;
            }

            this.$container = $container;
            if (this.$container) {
                this.$container.append(this.$frame);
            } else {
                this.$frame.remove();
            }
            return this.$container;
        },

        // Disconnects and prepares this widget for destruction.
        __destroy: function () {
            var docker = this.docker();
            if (docker) {
                var index = docker._tabList.indexOf(this);
                if (index > -1) {
                    docker._tabList.splice(index, 1);
                }
            }

            // Remove all registered events.
            while (this._boundEvents.length) {
                this._parent.off(this._boundEvents[0].event, this._boundEvents[0].handler);
                this._boundEvents.shift();
            }

            this._curTab = -1;
            for (var i = 0; i < this._layoutList.length; ++i) {
                this._layoutList[i].__destroy();
            }

            while (this._layoutList.length) this._layoutList.pop();
            this.__container(null);
            this._parent = null;
        }
    });

    // window['wcTabFrame'] = Module;

    return Module;
});

/**
 * @license
 * lodash 3.10.1 (Custom Build) <https://lodash.com/>
 * Build: `lodash compat exports="amd" -d -o ./main.js`
 * Copyright 2012-2015 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <https://lodash.com/license>
 */
;(function() {

  /** Used as a safe reference for `undefined` in pre-ES5 environments. */
  var undefined;

  /** Used as the semantic version number. */
  var VERSION = '3.10.1';

  /** Used to compose bitmasks for wrapper metadata. */
  var BIND_FLAG = 1,
      BIND_KEY_FLAG = 2,
      CURRY_BOUND_FLAG = 4,
      CURRY_FLAG = 8,
      CURRY_RIGHT_FLAG = 16,
      PARTIAL_FLAG = 32,
      PARTIAL_RIGHT_FLAG = 64,
      ARY_FLAG = 128,
      REARG_FLAG = 256;

  /** Used as default options for `_.trunc`. */
  var DEFAULT_TRUNC_LENGTH = 30,
      DEFAULT_TRUNC_OMISSION = '...';

  /** Used to detect when a function becomes hot. */
  var HOT_COUNT = 150,
      HOT_SPAN = 16;

  /** Used as the size to enable large array optimizations. */
  var LARGE_ARRAY_SIZE = 200;

  /** Used to indicate the type of lazy iteratees. */
  var LAZY_FILTER_FLAG = 1,
      LAZY_MAP_FLAG = 2;

  /** Used as the `TypeError` message for "Functions" methods. */
  var FUNC_ERROR_TEXT = 'Expected a function';

  /** Used as the internal argument placeholder. */
  var PLACEHOLDER = '__lodash_placeholder__';

  /** `Object#toString` result references. */
  var argsTag = '[object Arguments]',
      arrayTag = '[object Array]',
      boolTag = '[object Boolean]',
      dateTag = '[object Date]',
      errorTag = '[object Error]',
      funcTag = '[object Function]',
      mapTag = '[object Map]',
      numberTag = '[object Number]',
      objectTag = '[object Object]',
      regexpTag = '[object RegExp]',
      setTag = '[object Set]',
      stringTag = '[object String]',
      weakMapTag = '[object WeakMap]';

  var arrayBufferTag = '[object ArrayBuffer]',
      float32Tag = '[object Float32Array]',
      float64Tag = '[object Float64Array]',
      int8Tag = '[object Int8Array]',
      int16Tag = '[object Int16Array]',
      int32Tag = '[object Int32Array]',
      uint8Tag = '[object Uint8Array]',
      uint8ClampedTag = '[object Uint8ClampedArray]',
      uint16Tag = '[object Uint16Array]',
      uint32Tag = '[object Uint32Array]';

  /** Used to match empty string literals in compiled template source. */
  var reEmptyStringLeading = /\b__p \+= '';/g,
      reEmptyStringMiddle = /\b(__p \+=) '' \+/g,
      reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;

  /** Used to match HTML entities and HTML characters. */
  var reEscapedHtml = /&(?:amp|lt|gt|quot|#39|#96);/g,
      reUnescapedHtml = /[&<>"'`]/g,
      reHasEscapedHtml = RegExp(reEscapedHtml.source),
      reHasUnescapedHtml = RegExp(reUnescapedHtml.source);

  /** Used to match template delimiters. */
  var reEscape = /<%-([\s\S]+?)%>/g,
      reEvaluate = /<%([\s\S]+?)%>/g,
      reInterpolate = /<%=([\s\S]+?)%>/g;

  /** Used to match property names within property paths. */
  var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\n\\]|\\.)*?\1)\]/,
      reIsPlainProp = /^\w*$/,
      rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\n\\]|\\.)*?)\2)\]/g;

  /**
   * Used to match `RegExp` [syntax characters](http://ecma-international.org/ecma-262/6.0/#sec-patterns)
   * and those outlined by [`EscapeRegExpPattern`](http://ecma-international.org/ecma-262/6.0/#sec-escaperegexppattern).
   */
  var reRegExpChars = /^[:!,]|[\\^$.*+?()[\]{}|\/]|(^[0-9a-fA-Fnrtuvx])|([\n\r\u2028\u2029])/g,
      reHasRegExpChars = RegExp(reRegExpChars.source);

  /** Used to match [combining diacritical marks](https://en.wikipedia.org/wiki/Combining_Diacritical_Marks). */
  var reComboMark = /[\u0300-\u036f\ufe20-\ufe23]/g;

  /** Used to match backslashes in property paths. */
  var reEscapeChar = /\\(\\)?/g;

  /** Used to match [ES template delimiters](http://ecma-international.org/ecma-262/6.0/#sec-template-literal-lexical-components). */
  var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;

  /** Used to match `RegExp` flags from their coerced string values. */
  var reFlags = /\w*$/;

  /** Used to detect hexadecimal string values. */
  var reHasHexPrefix = /^0[xX]/;

  /** Used to detect host constructors (Safari > 5). */
  var reIsHostCtor = /^\[object .+?Constructor\]$/;

  /** Used to detect unsigned integer values. */
  var reIsUint = /^\d+$/;

  /** Used to match latin-1 supplementary letters (excluding mathematical operators). */
  var reLatin1 = /[\xc0-\xd6\xd8-\xde\xdf-\xf6\xf8-\xff]/g;

  /** Used to ensure capturing order of template delimiters. */
  var reNoMatch = /($^)/;

  /** Used to match unescaped characters in compiled string literals. */
  var reUnescapedString = /['\n\r\u2028\u2029\\]/g;

  /** Used to match words to create compound words. */
  var reWords = (function() {
    var upper = '[A-Z\\xc0-\\xd6\\xd8-\\xde]',
        lower = '[a-z\\xdf-\\xf6\\xf8-\\xff]+';

    return RegExp(upper + '+(?=' + upper + lower + ')|' + upper + '?' + lower + '|' + upper + '+|[0-9]+', 'g');
  }());

  /** Used to assign default `context` object properties. */
  var contextProps = [
    'Array', 'ArrayBuffer', 'Date', 'Error', 'Float32Array', 'Float64Array',
    'Function', 'Int8Array', 'Int16Array', 'Int32Array', 'Math', 'Number',
    'Object', 'RegExp', 'Set', 'String', '_', 'clearTimeout', 'isFinite',
    'parseFloat', 'parseInt', 'setTimeout', 'TypeError', 'Uint8Array',
    'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'WeakMap'
  ];

  /** Used to fix the JScript `[[DontEnum]]` bug. */
  var shadowProps = [
    'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
    'toLocaleString', 'toString', 'valueOf'
  ];

  /** Used to make template sourceURLs easier to identify. */
  var templateCounter = -1;

  /** Used to identify `toStringTag` values of typed arrays. */
  var typedArrayTags = {};
  typedArrayTags[float32Tag] = typedArrayTags[float64Tag] =
  typedArrayTags[int8Tag] = typedArrayTags[int16Tag] =
  typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] =
  typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] =
  typedArrayTags[uint32Tag] = true;
  typedArrayTags[argsTag] = typedArrayTags[arrayTag] =
  typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] =
  typedArrayTags[dateTag] = typedArrayTags[errorTag] =
  typedArrayTags[funcTag] = typedArrayTags[mapTag] =
  typedArrayTags[numberTag] = typedArrayTags[objectTag] =
  typedArrayTags[regexpTag] = typedArrayTags[setTag] =
  typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;

  /** Used to identify `toStringTag` values supported by `_.clone`. */
  var cloneableTags = {};
  cloneableTags[argsTag] = cloneableTags[arrayTag] =
  cloneableTags[arrayBufferTag] = cloneableTags[boolTag] =
  cloneableTags[dateTag] = cloneableTags[float32Tag] =
  cloneableTags[float64Tag] = cloneableTags[int8Tag] =
  cloneableTags[int16Tag] = cloneableTags[int32Tag] =
  cloneableTags[numberTag] = cloneableTags[objectTag] =
  cloneableTags[regexpTag] = cloneableTags[stringTag] =
  cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] =
  cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
  cloneableTags[errorTag] = cloneableTags[funcTag] =
  cloneableTags[mapTag] = cloneableTags[setTag] =
  cloneableTags[weakMapTag] = false;

  /** Used to map latin-1 supplementary letters to basic latin letters. */
  var deburredLetters = {
    '\xc0': 'A',  '\xc1': 'A', '\xc2': 'A', '\xc3': 'A', '\xc4': 'A', '\xc5': 'A',
    '\xe0': 'a',  '\xe1': 'a', '\xe2': 'a', '\xe3': 'a', '\xe4': 'a', '\xe5': 'a',
    '\xc7': 'C',  '\xe7': 'c',
    '\xd0': 'D',  '\xf0': 'd',
    '\xc8': 'E',  '\xc9': 'E', '\xca': 'E', '\xcb': 'E',
    '\xe8': 'e',  '\xe9': 'e', '\xea': 'e', '\xeb': 'e',
    '\xcC': 'I',  '\xcd': 'I', '\xce': 'I', '\xcf': 'I',
    '\xeC': 'i',  '\xed': 'i', '\xee': 'i', '\xef': 'i',
    '\xd1': 'N',  '\xf1': 'n',
    '\xd2': 'O',  '\xd3': 'O', '\xd4': 'O', '\xd5': 'O', '\xd6': 'O', '\xd8': 'O',
    '\xf2': 'o',  '\xf3': 'o', '\xf4': 'o', '\xf5': 'o', '\xf6': 'o', '\xf8': 'o',
    '\xd9': 'U',  '\xda': 'U', '\xdb': 'U', '\xdc': 'U',
    '\xf9': 'u',  '\xfa': 'u', '\xfb': 'u', '\xfc': 'u',
    '\xdd': 'Y',  '\xfd': 'y', '\xff': 'y',
    '\xc6': 'Ae', '\xe6': 'ae',
    '\xde': 'Th', '\xfe': 'th',
    '\xdf': 'ss'
  };

  /** Used to map characters to HTML entities. */
  var htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  };

  /** Used to map HTML entities to characters. */
  var htmlUnescapes = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#96;': '`'
  };

  /** Used to determine if values are of the language type `Object`. */
  var objectTypes = {
    'function': true,
    'object': true
  };

  /** Used to escape characters for inclusion in compiled regexes. */
  var regexpEscapes = {
    '0': 'x30', '1': 'x31', '2': 'x32', '3': 'x33', '4': 'x34',
    '5': 'x35', '6': 'x36', '7': 'x37', '8': 'x38', '9': 'x39',
    'A': 'x41', 'B': 'x42', 'C': 'x43', 'D': 'x44', 'E': 'x45', 'F': 'x46',
    'a': 'x61', 'b': 'x62', 'c': 'x63', 'd': 'x64', 'e': 'x65', 'f': 'x66',
    'n': 'x6e', 'r': 'x72', 't': 'x74', 'u': 'x75', 'v': 'x76', 'x': 'x78'
  };

  /** Used to escape characters for inclusion in compiled string literals. */
  var stringEscapes = {
    '\\': '\\',
    "'": "'",
    '\n': 'n',
    '\r': 'r',
    '\u2028': 'u2028',
    '\u2029': 'u2029'
  };

  /** Detect free variable `exports`. */
  var freeExports = objectTypes[typeof exports] && exports && !exports.nodeType && exports;

  /** Detect free variable `module`. */
  var freeModule = objectTypes[typeof module] && module && !module.nodeType && module;

  /** Detect free variable `global` from Node.js. */
  var freeGlobal = freeExports && freeModule && typeof global == 'object' && global && global.Object && global;

  /** Detect free variable `self`. */
  var freeSelf = objectTypes[typeof self] && self && self.Object && self;

  /** Detect free variable `window`. */
  var freeWindow = objectTypes[typeof window] && window && window.Object && window;

  /**
   * Used as a reference to the global object.
   *
   * The `this` value is used if it's the global object to avoid Greasemonkey's
   * restricted `window` object, otherwise the `window` object is used.
   */
  var root = freeGlobal || ((freeWindow !== (this && this.window)) && freeWindow) || freeSelf || this;

  /*--------------------------------------------------------------------------*/

  /**
   * The base implementation of `compareAscending` which compares values and
   * sorts them in ascending order without guaranteeing a stable sort.
   *
   * @private
   * @param {*} value The value to compare.
   * @param {*} other The other value to compare.
   * @returns {number} Returns the sort order indicator for `value`.
   */
  function baseCompareAscending(value, other) {
    if (value !== other) {
      var valIsNull = value === null,
          valIsUndef = value === undefined,
          valIsReflexive = value === value;

      var othIsNull = other === null,
          othIsUndef = other === undefined,
          othIsReflexive = other === other;

      if ((value > other && !othIsNull) || !valIsReflexive ||
          (valIsNull && !othIsUndef && othIsReflexive) ||
          (valIsUndef && othIsReflexive)) {
        return 1;
      }
      if ((value < other && !valIsNull) || !othIsReflexive ||
          (othIsNull && !valIsUndef && valIsReflexive) ||
          (othIsUndef && valIsReflexive)) {
        return -1;
      }
    }
    return 0;
  }

  /**
   * The base implementation of `_.findIndex` and `_.findLastIndex` without
   * support for callback shorthands and `this` binding.
   *
   * @private
   * @param {Array} array The array to search.
   * @param {Function} predicate The function invoked per iteration.
   * @param {boolean} [fromRight] Specify iterating from right to left.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function baseFindIndex(array, predicate, fromRight) {
    var length = array.length,
        index = fromRight ? length : -1;

    while ((fromRight ? index-- : ++index < length)) {
      if (predicate(array[index], index, array)) {
        return index;
      }
    }
    return -1;
  }

  /**
   * The base implementation of `_.indexOf` without support for binary searches.
   *
   * @private
   * @param {Array} array The array to search.
   * @param {*} value The value to search for.
   * @param {number} fromIndex The index to search from.
   * @returns {number} Returns the index of the matched value, else `-1`.
   */
  function baseIndexOf(array, value, fromIndex) {
    if (value !== value) {
      return indexOfNaN(array, fromIndex);
    }
    var index = fromIndex - 1,
        length = array.length;

    while (++index < length) {
      if (array[index] === value) {
        return index;
      }
    }
    return -1;
  }

  /**
   * The base implementation of `_.isFunction` without support for environments
   * with incorrect `typeof` results.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
   */
  function baseIsFunction(value) {
    // Avoid a Chakra JIT bug in compatibility modes of IE 11.
    // See https://github.com/jashkenas/underscore/issues/1621 for more details.
    return typeof value == 'function' || false;
  }

  /**
   * Converts `value` to a string if it's not one. An empty string is returned
   * for `null` or `undefined` values.
   *
   * @private
   * @param {*} value The value to process.
   * @returns {string} Returns the string.
   */
  function baseToString(value) {
    return value == null ? '' : (value + '');
  }

  /**
   * Used by `_.trim` and `_.trimLeft` to get the index of the first character
   * of `string` that is not found in `chars`.
   *
   * @private
   * @param {string} string The string to inspect.
   * @param {string} chars The characters to find.
   * @returns {number} Returns the index of the first character not found in `chars`.
   */
  function charsLeftIndex(string, chars) {
    var index = -1,
        length = string.length;

    while (++index < length && chars.indexOf(string.charAt(index)) > -1) {}
    return index;
  }

  /**
   * Used by `_.trim` and `_.trimRight` to get the index of the last character
   * of `string` that is not found in `chars`.
   *
   * @private
   * @param {string} string The string to inspect.
   * @param {string} chars The characters to find.
   * @returns {number} Returns the index of the last character not found in `chars`.
   */
  function charsRightIndex(string, chars) {
    var index = string.length;

    while (index-- && chars.indexOf(string.charAt(index)) > -1) {}
    return index;
  }

  /**
   * Used by `_.sortBy` to compare transformed elements of a collection and stable
   * sort them in ascending order.
   *
   * @private
   * @param {Object} object The object to compare.
   * @param {Object} other The other object to compare.
   * @returns {number} Returns the sort order indicator for `object`.
   */
  function compareAscending(object, other) {
    return baseCompareAscending(object.criteria, other.criteria) || (object.index - other.index);
  }

  /**
   * Used by `_.sortByOrder` to compare multiple properties of a value to another
   * and stable sort them.
   *
   * If `orders` is unspecified, all valuess are sorted in ascending order. Otherwise,
   * a value is sorted in ascending order if its corresponding order is "asc", and
   * descending if "desc".
   *
   * @private
   * @param {Object} object The object to compare.
   * @param {Object} other The other object to compare.
   * @param {boolean[]} orders The order to sort by for each property.
   * @returns {number} Returns the sort order indicator for `object`.
   */
  function compareMultiple(object, other, orders) {
    var index = -1,
        objCriteria = object.criteria,
        othCriteria = other.criteria,
        length = objCriteria.length,
        ordersLength = orders.length;

    while (++index < length) {
      var result = baseCompareAscending(objCriteria[index], othCriteria[index]);
      if (result) {
        if (index >= ordersLength) {
          return result;
        }
        var order = orders[index];
        return result * ((order === 'asc' || order === true) ? 1 : -1);
      }
    }
    // Fixes an `Array#sort` bug in the JS engine embedded in Adobe applications
    // that causes it, under certain circumstances, to provide the same value for
    // `object` and `other`. See https://github.com/jashkenas/underscore/pull/1247
    // for more details.
    //
    // This also ensures a stable sort in V8 and other engines.
    // See https://code.google.com/p/v8/issues/detail?id=90 for more details.
    return object.index - other.index;
  }

  /**
   * Used by `_.deburr` to convert latin-1 supplementary letters to basic latin letters.
   *
   * @private
   * @param {string} letter The matched letter to deburr.
   * @returns {string} Returns the deburred letter.
   */
  function deburrLetter(letter) {
    return deburredLetters[letter];
  }

  /**
   * Used by `_.escape` to convert characters to HTML entities.
   *
   * @private
   * @param {string} chr The matched character to escape.
   * @returns {string} Returns the escaped character.
   */
  function escapeHtmlChar(chr) {
    return htmlEscapes[chr];
  }

  /**
   * Used by `_.escapeRegExp` to escape characters for inclusion in compiled regexes.
   *
   * @private
   * @param {string} chr The matched character to escape.
   * @param {string} leadingChar The capture group for a leading character.
   * @param {string} whitespaceChar The capture group for a whitespace character.
   * @returns {string} Returns the escaped character.
   */
  function escapeRegExpChar(chr, leadingChar, whitespaceChar) {
    if (leadingChar) {
      chr = regexpEscapes[chr];
    } else if (whitespaceChar) {
      chr = stringEscapes[chr];
    }
    return '\\' + chr;
  }

  /**
   * Used by `_.template` to escape characters for inclusion in compiled string literals.
   *
   * @private
   * @param {string} chr The matched character to escape.
   * @returns {string} Returns the escaped character.
   */
  function escapeStringChar(chr) {
    return '\\' + stringEscapes[chr];
  }

  /**
   * Gets the index at which the first occurrence of `NaN` is found in `array`.
   *
   * @private
   * @param {Array} array The array to search.
   * @param {number} fromIndex The index to search from.
   * @param {boolean} [fromRight] Specify iterating from right to left.
   * @returns {number} Returns the index of the matched `NaN`, else `-1`.
   */
  function indexOfNaN(array, fromIndex, fromRight) {
    var length = array.length,
        index = fromIndex + (fromRight ? 0 : -1);

    while ((fromRight ? index-- : ++index < length)) {
      var other = array[index];
      if (other !== other) {
        return index;
      }
    }
    return -1;
  }

  /**
   * Checks if `value` is a host object in IE < 9.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is a host object, else `false`.
   */
  var isHostObject = (function() {
    try {
      Object({ 'toString': 0 } + '');
    } catch(e) {
      return function() { return false; };
    }
    return function(value) {
      // IE < 9 presents many host objects as `Object` objects that can coerce
      // to strings despite having improperly defined `toString` methods.
      return typeof value.toString != 'function' && typeof (value + '') == 'string';
    };
  }());

  /**
   * Checks if `value` is object-like.
   *
   * @private
   * @param {*} value The value to check.
   * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
   */
  function isObjectLike(value) {
    return !!value && typeof value == 'object';
  }

  /**
   * Used by `trimmedLeftIndex` and `trimmedRightIndex` to determine if a
   * character code is whitespace.
   *
   * @private
   * @param {number} charCode The character code to inspect.
   * @returns {boolean} Returns `true` if `charCode` is whitespace, else `false`.
   */
  function isSpace(charCode) {
    return ((charCode <= 160 && (charCode >= 9 && charCode <= 13) || charCode == 32 || charCode == 160) || charCode == 5760 || charCode == 6158 ||
      (charCode >= 8192 && (charCode <= 8202 || charCode == 8232 || charCode == 8233 || charCode == 8239 || charCode == 8287 || charCode == 12288 || charCode == 65279)));
  }

  /**
   * Replaces all `placeholder` elements in `array` with an internal placeholder
   * and returns an array of their indexes.
   *
   * @private
   * @param {Array} array The array to modify.
   * @param {*} placeholder The placeholder to replace.
   * @returns {Array} Returns the new array of placeholder indexes.
   */
  function replaceHolders(array, placeholder) {
    var index = -1,
        length = array.length,
        resIndex = -1,
        result = [];

    while (++index < length) {
      if (array[index] === placeholder) {
        array[index] = PLACEHOLDER;
        result[++resIndex] = index;
      }
    }
    return result;
  }

  /**
   * An implementation of `_.uniq` optimized for sorted arrays without support
   * for callback shorthands and `this` binding.
   *
   * @private
   * @param {Array} array The array to inspect.
   * @param {Function} [iteratee] The function invoked per iteration.
   * @returns {Array} Returns the new duplicate free array.
   */
  function sortedUniq(array, iteratee) {
    var seen,
        index = -1,
        length = array.length,
        resIndex = -1,
        result = [];

    while (++index < length) {
      var value = array[index],
          computed = iteratee ? iteratee(value, index, array) : value;

      if (!index || seen !== computed) {
        seen = computed;
        result[++resIndex] = value;
      }
    }
    return result;
  }

  /**
   * Used by `_.trim` and `_.trimLeft` to get the index of the first non-whitespace
   * character of `string`.
   *
   * @private
   * @param {string} string The string to inspect.
   * @returns {number} Returns the index of the first non-whitespace character.
   */
  function trimmedLeftIndex(string) {
    var index = -1,
        length = string.length;

    while (++index < length && isSpace(string.charCodeAt(index))) {}
    return index;
  }

  /**
   * Used by `_.trim` and `_.trimRight` to get the index of the last non-whitespace
   * character of `string`.
   *
   * @private
   * @param {string} string The string to inspect.
   * @returns {number} Returns the index of the last non-whitespace character.
   */
  function trimmedRightIndex(string) {
    var index = string.length;

    while (index-- && isSpace(string.charCodeAt(index))) {}
    return index;
  }

  /**
   * Used by `_.unescape` to convert HTML entities to characters.
   *
   * @private
   * @param {string} chr The matched character to unescape.
   * @returns {string} Returns the unescaped character.
   */
  function unescapeHtmlChar(chr) {
    return htmlUnescapes[chr];
  }

  /*--------------------------------------------------------------------------*/

  /**
   * Create a new pristine `lodash` function using the given `context` object.
   *
   * @static
   * @memberOf _
   * @category Utility
   * @param {Object} [context=root] The context object.
   * @returns {Function} Returns a new `lodash` function.
   * @example
   *
   * _.mixin({ 'foo': _.constant('foo') });
   *
   * var lodash = _.runInContext();
   * lodash.mixin({ 'bar': lodash.constant('bar') });
   *
   * _.isFunction(_.foo);
   * // => true
   * _.isFunction(_.bar);
   * // => false
   *
   * lodash.isFunction(lodash.foo);
   * // => false
   * lodash.isFunction(lodash.bar);
   * // => true
   *
   * // using `context` to mock `Date#getTime` use in `_.now`
   * var mock = _.runInContext({
   *   'Date': function() {
   *     return { 'getTime': getTimeMock };
   *   }
   * });
   *
   * // or creating a suped-up `defer` in Node.js
   * var defer = _.runInContext({ 'setTimeout': setImmediate }).defer;
   */
  function runInContext(context) {
    // Avoid issues with some ES3 environments that attempt to use values, named
    // after built-in constructors like `Object`, for the creation of literals.
    // ES5 clears this up by stating that literals must use built-in constructors.
    // See https://es5.github.io/#x11.1.5 for more details.
    context = context ? _.defaults(root.Object(), context, _.pick(root, contextProps)) : root;

    /** Native constructor references. */
    var Array = context.Array,
        Date = context.Date,
        Error = context.Error,
        Function = context.Function,
        Math = context.Math,
        Number = context.Number,
        Object = context.Object,
        RegExp = context.RegExp,
        String = context.String,
        TypeError = context.TypeError;

    /** Used for native method references. */
    var arrayProto = Array.prototype,
        errorProto = Error.prototype,
        objectProto = Object.prototype,
        stringProto = String.prototype;

    /** Used to resolve the decompiled source of functions. */
    var fnToString = Function.prototype.toString;

    /** Used to check objects for own properties. */
    var hasOwnProperty = objectProto.hasOwnProperty;

    /** Used to generate unique IDs. */
    var idCounter = 0;

    /**
     * Used to resolve the [`toStringTag`](http://ecma-international.org/ecma-262/6.0/#sec-object.prototype.tostring)
     * of values.
     */
    var objToString = objectProto.toString;

    /** Used to restore the original `_` reference in `_.noConflict`. */
    var oldDash = root._;

    /** Used to detect if a method is native. */
    var reIsNative = RegExp('^' +
      fnToString.call(hasOwnProperty).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
      .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
    );

    /** Native method references. */
    var ArrayBuffer = context.ArrayBuffer,
        clearTimeout = context.clearTimeout,
        parseFloat = context.parseFloat,
        pow = Math.pow,
        propertyIsEnumerable = objectProto.propertyIsEnumerable,
        Set = getNative(context, 'Set'),
        setTimeout = context.setTimeout,
        splice = arrayProto.splice,
        Uint8Array = context.Uint8Array,
        WeakMap = getNative(context, 'WeakMap');

    /* Native method references for those with the same name as other `lodash` methods. */
    var nativeCeil = Math.ceil,
        nativeCreate = getNative(Object, 'create'),
        nativeFloor = Math.floor,
        nativeIsArray = getNative(Array, 'isArray'),
        nativeIsFinite = context.isFinite,
        nativeKeys = getNative(Object, 'keys'),
        nativeMax = Math.max,
        nativeMin = Math.min,
        nativeNow = getNative(Date, 'now'),
        nativeParseInt = context.parseInt,
        nativeRandom = Math.random;

    /** Used as references for `-Infinity` and `Infinity`. */
    var NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY,
        POSITIVE_INFINITY = Number.POSITIVE_INFINITY;

    /** Used as references for the maximum length and index of an array. */
    var MAX_ARRAY_LENGTH = 4294967295,
        MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1,
        HALF_MAX_ARRAY_LENGTH = MAX_ARRAY_LENGTH >>> 1;

    /**
     * Used as the [maximum length](http://ecma-international.org/ecma-262/6.0/#sec-number.max_safe_integer)
     * of an array-like value.
     */
    var MAX_SAFE_INTEGER = 9007199254740991;

    /** Used to store function metadata. */
    var metaMap = WeakMap && new WeakMap;

    /** Used to lookup unminified function names. */
    var realNames = {};

    /** Used to lookup a type array constructors by `toStringTag`. */
    var ctorByTag = {};
    ctorByTag[float32Tag] = context.Float32Array;
    ctorByTag[float64Tag] = context.Float64Array;
    ctorByTag[int8Tag] = context.Int8Array;
    ctorByTag[int16Tag] = context.Int16Array;
    ctorByTag[int32Tag] = context.Int32Array;
    ctorByTag[uint8Tag] = Uint8Array;
    ctorByTag[uint8ClampedTag] = context.Uint8ClampedArray;
    ctorByTag[uint16Tag] = context.Uint16Array;
    ctorByTag[uint32Tag] = context.Uint32Array;

    /** Used to avoid iterating over non-enumerable properties in IE < 9. */
    var nonEnumProps = {};
    nonEnumProps[arrayTag] = nonEnumProps[dateTag] = nonEnumProps[numberTag] = { 'constructor': true, 'toLocaleString': true, 'toString': true, 'valueOf': true };
    nonEnumProps[boolTag] = nonEnumProps[stringTag] = { 'constructor': true, 'toString': true, 'valueOf': true };
    nonEnumProps[errorTag] = nonEnumProps[funcTag] = nonEnumProps[regexpTag] = { 'constructor': true, 'toString': true };
    nonEnumProps[objectTag] = { 'constructor': true };

    arrayEach(shadowProps, function(key) {
      for (var tag in nonEnumProps) {
        if (hasOwnProperty.call(nonEnumProps, tag)) {
          var props = nonEnumProps[tag];
          props[key] = hasOwnProperty.call(props, key);
        }
      }
    });

    /*------------------------------------------------------------------------*/

    /**
     * Creates a `lodash` object which wraps `value` to enable implicit chaining.
     * Methods that operate on and return arrays, collections, and functions can
     * be chained together. Methods that retrieve a single value or may return a
     * primitive value will automatically end the chain returning the unwrapped
     * value. Explicit chaining may be enabled using `_.chain`. The execution of
     * chained methods is lazy, that is, execution is deferred until `_#value`
     * is implicitly or explicitly called.
     *
     * Lazy evaluation allows several methods to support shortcut fusion. Shortcut
     * fusion is an optimization strategy which merge iteratee calls; this can help
     * to avoid the creation of intermediate data structures and greatly reduce the
     * number of iteratee executions.
     *
     * Chaining is supported in custom builds as long as the `_#value` method is
     * directly or indirectly included in the build.
     *
     * In addition to lodash methods, wrappers have `Array` and `String` methods.
     *
     * The wrapper `Array` methods are:
     * `concat`, `join`, `pop`, `push`, `reverse`, `shift`, `slice`, `sort`,
     * `splice`, and `unshift`
     *
     * The wrapper `String` methods are:
     * `replace` and `split`
     *
     * The wrapper methods that support shortcut fusion are:
     * `compact`, `drop`, `dropRight`, `dropRightWhile`, `dropWhile`, `filter`,
     * `first`, `initial`, `last`, `map`, `pluck`, `reject`, `rest`, `reverse`,
     * `slice`, `take`, `takeRight`, `takeRightWhile`, `takeWhile`, `toArray`,
     * and `where`
     *
     * The chainable wrapper methods are:
     * `after`, `ary`, `assign`, `at`, `before`, `bind`, `bindAll`, `bindKey`,
     * `callback`, `chain`, `chunk`, `commit`, `compact`, `concat`, `constant`,
     * `countBy`, `create`, `curry`, `debounce`, `defaults`, `defaultsDeep`,
     * `defer`, `delay`, `difference`, `drop`, `dropRight`, `dropRightWhile`,
     * `dropWhile`, `fill`, `filter`, `flatten`, `flattenDeep`, `flow`, `flowRight`,
     * `forEach`, `forEachRight`, `forIn`, `forInRight`, `forOwn`, `forOwnRight`,
     * `functions`, `groupBy`, `indexBy`, `initial`, `intersection`, `invert`,
     * `invoke`, `keys`, `keysIn`, `map`, `mapKeys`, `mapValues`, `matches`,
     * `matchesProperty`, `memoize`, `merge`, `method`, `methodOf`, `mixin`,
     * `modArgs`, `negate`, `omit`, `once`, `pairs`, `partial`, `partialRight`,
     * `partition`, `pick`, `plant`, `pluck`, `property`, `propertyOf`, `pull`,
     * `pullAt`, `push`, `range`, `rearg`, `reject`, `remove`, `rest`, `restParam`,
     * `reverse`, `set`, `shuffle`, `slice`, `sort`, `sortBy`, `sortByAll`,
     * `sortByOrder`, `splice`, `spread`, `take`, `takeRight`, `takeRightWhile`,
     * `takeWhile`, `tap`, `throttle`, `thru`, `times`, `toArray`, `toPlainObject`,
     * `transform`, `union`, `uniq`, `unshift`, `unzip`, `unzipWith`, `values`,
     * `valuesIn`, `where`, `without`, `wrap`, `xor`, `zip`, `zipObject`, `zipWith`
     *
     * The wrapper methods that are **not** chainable by default are:
     * `add`, `attempt`, `camelCase`, `capitalize`, `ceil`, `clone`, `cloneDeep`,
     * `deburr`, `endsWith`, `escape`, `escapeRegExp`, `every`, `find`, `findIndex`,
     * `findKey`, `findLast`, `findLastIndex`, `findLastKey`, `findWhere`, `first`,
     * `floor`, `get`, `gt`, `gte`, `has`, `identity`, `includes`, `indexOf`,
     * `inRange`, `isArguments`, `isArray`, `isBoolean`, `isDate`, `isElement`,
     * `isEmpty`, `isEqual`, `isError`, `isFinite` `isFunction`, `isMatch`,
     * `isNative`, `isNaN`, `isNull`, `isNumber`, `isObject`, `isPlainObject`,
     * `isRegExp`, `isString`, `isUndefined`, `isTypedArray`, `join`, `kebabCase`,
     * `last`, `lastIndexOf`, `lt`, `lte`, `max`, `min`, `noConflict`, `noop`,
     * `now`, `pad`, `padLeft`, `padRight`, `parseInt`, `pop`, `random`, `reduce`,
     * `reduceRight`, `repeat`, `result`, `round`, `runInContext`, `shift`, `size`,
     * `snakeCase`, `some`, `sortedIndex`, `sortedLastIndex`, `startCase`,
     * `startsWith`, `sum`, `template`, `trim`, `trimLeft`, `trimRight`, `trunc`,
     * `unescape`, `uniqueId`, `value`, and `words`
     *
     * The wrapper method `sample` will return a wrapped value when `n` is provided,
     * otherwise an unwrapped value is returned.
     *
     * @name _
     * @constructor
     * @category Chain
     * @param {*} value The value to wrap in a `lodash` instance.
     * @returns {Object} Returns the new `lodash` wrapper instance.
     * @example
     *
     * var wrapped = _([1, 2, 3]);
     *
     * // returns an unwrapped value
     * wrapped.reduce(function(total, n) {
     *   return total + n;
     * });
     * // => 6
     *
     * // returns a wrapped value
     * var squares = wrapped.map(function(n) {
     *   return n * n;
     * });
     *
     * _.isArray(squares);
     * // => false
     *
     * _.isArray(squares.value());
     * // => true
     */
    function lodash(value) {
      if (isObjectLike(value) && !isArray(value) && !(value instanceof LazyWrapper)) {
        if (value instanceof LodashWrapper) {
          return value;
        }
        if (hasOwnProperty.call(value, '__chain__') && hasOwnProperty.call(value, '__wrapped__')) {
          return wrapperClone(value);
        }
      }
      return new LodashWrapper(value);
    }

    /**
     * The function whose prototype all chaining wrappers inherit from.
     *
     * @private
     */
    function baseLodash() {
      // No operation performed.
    }

    /**
     * The base constructor for creating `lodash` wrapper objects.
     *
     * @private
     * @param {*} value The value to wrap.
     * @param {boolean} [chainAll] Enable chaining for all wrapper methods.
     * @param {Array} [actions=[]] Actions to peform to resolve the unwrapped value.
     */
    function LodashWrapper(value, chainAll, actions) {
      this.__wrapped__ = value;
      this.__actions__ = actions || [];
      this.__chain__ = !!chainAll;
    }

    /**
     * An object environment feature flags.
     *
     * @static
     * @memberOf _
     * @type Object
     */
    var support = lodash.support = {};

    (function(x) {
      var Ctor = function() { this.x = x; },
          object = { '0': x, 'length': x },
          props = [];

      Ctor.prototype = { 'valueOf': x, 'y': x };
      for (var key in new Ctor) { props.push(key); }

      /**
       * Detect if `name` or `message` properties of `Error.prototype` are
       * enumerable by default (IE < 9, Safari < 5.1).
       *
       * @memberOf _.support
       * @type boolean
       */
      support.enumErrorProps = propertyIsEnumerable.call(errorProto, 'message') ||
        propertyIsEnumerable.call(errorProto, 'name');

      /**
       * Detect if `prototype` properties are enumerable by default.
       *
       * Firefox < 3.6, Opera > 9.50 - Opera < 11.60, and Safari < 5.1
       * (if the prototype or a property on the prototype has been set)
       * incorrectly set the `[[Enumerable]]` value of a function's `prototype`
       * property to `true`.
       *
       * @memberOf _.support
       * @type boolean
       */
      support.enumPrototypes = propertyIsEnumerable.call(Ctor, 'prototype');

      /**
       * Detect if properties shadowing those on `Object.prototype` are non-enumerable.
       *
       * In IE < 9 an object's own properties, shadowing non-enumerable ones,
       * are made non-enumerable as well (a.k.a the JScript `[[DontEnum]]` bug).
       *
       * @memberOf _.support
       * @type boolean
       */
      support.nonEnumShadows = !/valueOf/.test(props);

      /**
       * Detect if own properties are iterated after inherited properties (IE < 9).
       *
       * @memberOf _.support
       * @type boolean
       */
      support.ownLast = props[0] != 'x';

      /**
       * Detect if `Array#shift` and `Array#splice` augment array-like objects
       * correctly.
       *
       * Firefox < 10, compatibility modes of IE 8, and IE < 9 have buggy Array
       * `shift()` and `splice()` functions that fail to remove the last element,
       * `value[0]`, of array-like objects even though the "length" property is
       * set to `0`. The `shift()` method is buggy in compatibility modes of IE 8,
       * while `splice()` is buggy regardless of mode in IE < 9.
       *
       * @memberOf _.support
       * @type boolean
       */
      support.spliceObjects = (splice.call(object, 0, 1), !object[0]);

      /**
       * Detect lack of support for accessing string characters by index.
       *
       * IE < 8 can't access characters by index. IE 8 can only access characters
       * by index on string literals, not string objects.
       *
       * @memberOf _.support
       * @type boolean
       */
      support.unindexedChars = ('x'[0] + Object('x')[0]) != 'xx';
    }(1, 0));

    /**
     * By default, the template delimiters used by lodash are like those in
     * embedded Ruby (ERB). Change the following template settings to use
     * alternative delimiters.
     *
     * @static
     * @memberOf _
     * @type Object
     */
    lodash.templateSettings = {

      /**
       * Used to detect `data` property values to be HTML-escaped.
       *
       * @memberOf _.templateSettings
       * @type RegExp
       */
      'escape': reEscape,

      /**
       * Used to detect code to be evaluated.
       *
       * @memberOf _.templateSettings
       * @type RegExp
       */
      'evaluate': reEvaluate,

      /**
       * Used to detect `data` property values to inject.
       *
       * @memberOf _.templateSettings
       * @type RegExp
       */
      'interpolate': reInterpolate,

      /**
       * Used to reference the data object in the template text.
       *
       * @memberOf _.templateSettings
       * @type string
       */
      'variable': '',

      /**
       * Used to import variables into the compiled template.
       *
       * @memberOf _.templateSettings
       * @type Object
       */
      'imports': {

        /**
         * A reference to the `lodash` function.
         *
         * @memberOf _.templateSettings.imports
         * @type Function
         */
        '_': lodash
      }
    };

    /*------------------------------------------------------------------------*/

    /**
     * Creates a lazy wrapper object which wraps `value` to enable lazy evaluation.
     *
     * @private
     * @param {*} value The value to wrap.
     */
    function LazyWrapper(value) {
      this.__wrapped__ = value;
      this.__actions__ = [];
      this.__dir__ = 1;
      this.__filtered__ = false;
      this.__iteratees__ = [];
      this.__takeCount__ = POSITIVE_INFINITY;
      this.__views__ = [];
    }

    /**
     * Creates a clone of the lazy wrapper object.
     *
     * @private
     * @name clone
     * @memberOf LazyWrapper
     * @returns {Object} Returns the cloned `LazyWrapper` object.
     */
    function lazyClone() {
      var result = new LazyWrapper(this.__wrapped__);
      result.__actions__ = arrayCopy(this.__actions__);
      result.__dir__ = this.__dir__;
      result.__filtered__ = this.__filtered__;
      result.__iteratees__ = arrayCopy(this.__iteratees__);
      result.__takeCount__ = this.__takeCount__;
      result.__views__ = arrayCopy(this.__views__);
      return result;
    }

    /**
     * Reverses the direction of lazy iteration.
     *
     * @private
     * @name reverse
     * @memberOf LazyWrapper
     * @returns {Object} Returns the new reversed `LazyWrapper` object.
     */
    function lazyReverse() {
      if (this.__filtered__) {
        var result = new LazyWrapper(this);
        result.__dir__ = -1;
        result.__filtered__ = true;
      } else {
        result = this.clone();
        result.__dir__ *= -1;
      }
      return result;
    }

    /**
     * Extracts the unwrapped value from its lazy wrapper.
     *
     * @private
     * @name value
     * @memberOf LazyWrapper
     * @returns {*} Returns the unwrapped value.
     */
    function lazyValue() {
      var array = this.__wrapped__.value(),
          dir = this.__dir__,
          isArr = isArray(array),
          isRight = dir < 0,
          arrLength = isArr ? array.length : 0,
          view = getView(0, arrLength, this.__views__),
          start = view.start,
          end = view.end,
          length = end - start,
          index = isRight ? end : (start - 1),
          iteratees = this.__iteratees__,
          iterLength = iteratees.length,
          resIndex = 0,
          takeCount = nativeMin(length, this.__takeCount__);

      if (!isArr || arrLength < LARGE_ARRAY_SIZE || (arrLength == length && takeCount == length)) {
        return baseWrapperValue(array, this.__actions__);
      }
      var result = [];

      outer:
      while (length-- && resIndex < takeCount) {
        index += dir;

        var iterIndex = -1,
            value = array[index];

        while (++iterIndex < iterLength) {
          var data = iteratees[iterIndex],
              iteratee = data.iteratee,
              type = data.type,
              computed = iteratee(value);

          if (type == LAZY_MAP_FLAG) {
            value = computed;
          } else if (!computed) {
            if (type == LAZY_FILTER_FLAG) {
              continue outer;
            } else {
              break outer;
            }
          }
        }
        result[resIndex++] = value;
      }
      return result;
    }

    /*------------------------------------------------------------------------*/

    /**
     * Creates a cache object to store key/value pairs.
     *
     * @private
     * @static
     * @name Cache
     * @memberOf _.memoize
     */
    function MapCache() {
      this.__data__ = {};
    }

    /**
     * Removes `key` and its value from the cache.
     *
     * @private
     * @name delete
     * @memberOf _.memoize.Cache
     * @param {string} key The key of the value to remove.
     * @returns {boolean} Returns `true` if the entry was removed successfully, else `false`.
     */
    function mapDelete(key) {
      return this.has(key) && delete this.__data__[key];
    }

    /**
     * Gets the cached value for `key`.
     *
     * @private
     * @name get
     * @memberOf _.memoize.Cache
     * @param {string} key The key of the value to get.
     * @returns {*} Returns the cached value.
     */
    function mapGet(key) {
      return key == '__proto__' ? undefined : this.__data__[key];
    }

    /**
     * Checks if a cached value for `key` exists.
     *
     * @private
     * @name has
     * @memberOf _.memoize.Cache
     * @param {string} key The key of the entry to check.
     * @returns {boolean} Returns `true` if an entry for `key` exists, else `false`.
     */
    function mapHas(key) {
      return key != '__proto__' && hasOwnProperty.call(this.__data__, key);
    }

    /**
     * Sets `value` to `key` of the cache.
     *
     * @private
     * @name set
     * @memberOf _.memoize.Cache
     * @param {string} key The key of the value to cache.
     * @param {*} value The value to cache.
     * @returns {Object} Returns the cache object.
     */
    function mapSet(key, value) {
      if (key != '__proto__') {
        this.__data__[key] = value;
      }
      return this;
    }

    /*------------------------------------------------------------------------*/

    /**
     *
     * Creates a cache object to store unique values.
     *
     * @private
     * @param {Array} [values] The values to cache.
     */
    function SetCache(values) {
      var length = values ? values.length : 0;

      this.data = { 'hash': nativeCreate(null), 'set': new Set };
      while (length--) {
        this.push(values[length]);
      }
    }

    /**
     * Checks if `value` is in `cache` mimicking the return signature of
     * `_.indexOf` by returning `0` if the value is found, else `-1`.
     *
     * @private
     * @param {Object} cache The cache to search.
     * @param {*} value The value to search for.
     * @returns {number} Returns `0` if `value` is found, else `-1`.
     */
    function cacheIndexOf(cache, value) {
      var data = cache.data,
          result = (typeof value == 'string' || isObject(value)) ? data.set.has(value) : data.hash[value];

      return result ? 0 : -1;
    }

    /**
     * Adds `value` to the cache.
     *
     * @private
     * @name push
     * @memberOf SetCache
     * @param {*} value The value to cache.
     */
    function cachePush(value) {
      var data = this.data;
      if (typeof value == 'string' || isObject(value)) {
        data.set.add(value);
      } else {
        data.hash[value] = true;
      }
    }

    /*------------------------------------------------------------------------*/

    /**
     * Creates a new array joining `array` with `other`.
     *
     * @private
     * @param {Array} array The array to join.
     * @param {Array} other The other array to join.
     * @returns {Array} Returns the new concatenated array.
     */
    function arrayConcat(array, other) {
      var index = -1,
          length = array.length,
          othIndex = -1,
          othLength = other.length,
          result = Array(length + othLength);

      while (++index < length) {
        result[index] = array[index];
      }
      while (++othIndex < othLength) {
        result[index++] = other[othIndex];
      }
      return result;
    }

    /**
     * Copies the values of `source` to `array`.
     *
     * @private
     * @param {Array} source The array to copy values from.
     * @param {Array} [array=[]] The array to copy values to.
     * @returns {Array} Returns `array`.
     */
    function arrayCopy(source, array) {
      var index = -1,
          length = source.length;

      array || (array = Array(length));
      while (++index < length) {
        array[index] = source[index];
      }
      return array;
    }

    /**
     * A specialized version of `_.forEach` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns `array`.
     */
    function arrayEach(array, iteratee) {
      var index = -1,
          length = array.length;

      while (++index < length) {
        if (iteratee(array[index], index, array) === false) {
          break;
        }
      }
      return array;
    }

    /**
     * A specialized version of `_.forEachRight` for arrays without support for
     * callback shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns `array`.
     */
    function arrayEachRight(array, iteratee) {
      var length = array.length;

      while (length--) {
        if (iteratee(array[length], length, array) === false) {
          break;
        }
      }
      return array;
    }

    /**
     * A specialized version of `_.every` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {boolean} Returns `true` if all elements pass the predicate check,
     *  else `false`.
     */
    function arrayEvery(array, predicate) {
      var index = -1,
          length = array.length;

      while (++index < length) {
        if (!predicate(array[index], index, array)) {
          return false;
        }
      }
      return true;
    }

    /**
     * A specialized version of `baseExtremum` for arrays which invokes `iteratee`
     * with one argument: (value).
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {Function} comparator The function used to compare values.
     * @param {*} exValue The initial extremum value.
     * @returns {*} Returns the extremum value.
     */
    function arrayExtremum(array, iteratee, comparator, exValue) {
      var index = -1,
          length = array.length,
          computed = exValue,
          result = computed;

      while (++index < length) {
        var value = array[index],
            current = +iteratee(value);

        if (comparator(current, computed)) {
          computed = current;
          result = value;
        }
      }
      return result;
    }

    /**
     * A specialized version of `_.filter` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {Array} Returns the new filtered array.
     */
    function arrayFilter(array, predicate) {
      var index = -1,
          length = array.length,
          resIndex = -1,
          result = [];

      while (++index < length) {
        var value = array[index];
        if (predicate(value, index, array)) {
          result[++resIndex] = value;
        }
      }
      return result;
    }

    /**
     * A specialized version of `_.map` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns the new mapped array.
     */
    function arrayMap(array, iteratee) {
      var index = -1,
          length = array.length,
          result = Array(length);

      while (++index < length) {
        result[index] = iteratee(array[index], index, array);
      }
      return result;
    }

    /**
     * Appends the elements of `values` to `array`.
     *
     * @private
     * @param {Array} array The array to modify.
     * @param {Array} values The values to append.
     * @returns {Array} Returns `array`.
     */
    function arrayPush(array, values) {
      var index = -1,
          length = values.length,
          offset = array.length;

      while (++index < length) {
        array[offset + index] = values[index];
      }
      return array;
    }

    /**
     * A specialized version of `_.reduce` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {*} [accumulator] The initial value.
     * @param {boolean} [initFromArray] Specify using the first element of `array`
     *  as the initial value.
     * @returns {*} Returns the accumulated value.
     */
    function arrayReduce(array, iteratee, accumulator, initFromArray) {
      var index = -1,
          length = array.length;

      if (initFromArray && length) {
        accumulator = array[++index];
      }
      while (++index < length) {
        accumulator = iteratee(accumulator, array[index], index, array);
      }
      return accumulator;
    }

    /**
     * A specialized version of `_.reduceRight` for arrays without support for
     * callback shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {*} [accumulator] The initial value.
     * @param {boolean} [initFromArray] Specify using the last element of `array`
     *  as the initial value.
     * @returns {*} Returns the accumulated value.
     */
    function arrayReduceRight(array, iteratee, accumulator, initFromArray) {
      var length = array.length;
      if (initFromArray && length) {
        accumulator = array[--length];
      }
      while (length--) {
        accumulator = iteratee(accumulator, array[length], length, array);
      }
      return accumulator;
    }

    /**
     * A specialized version of `_.some` for arrays without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {boolean} Returns `true` if any element passes the predicate check,
     *  else `false`.
     */
    function arraySome(array, predicate) {
      var index = -1,
          length = array.length;

      while (++index < length) {
        if (predicate(array[index], index, array)) {
          return true;
        }
      }
      return false;
    }

    /**
     * A specialized version of `_.sum` for arrays without support for callback
     * shorthands and `this` binding..
     *
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {number} Returns the sum.
     */
    function arraySum(array, iteratee) {
      var length = array.length,
          result = 0;

      while (length--) {
        result += +iteratee(array[length]) || 0;
      }
      return result;
    }

    /**
     * Used by `_.defaults` to customize its `_.assign` use.
     *
     * @private
     * @param {*} objectValue The destination object property value.
     * @param {*} sourceValue The source object property value.
     * @returns {*} Returns the value to assign to the destination object.
     */
    function assignDefaults(objectValue, sourceValue) {
      return objectValue === undefined ? sourceValue : objectValue;
    }

    /**
     * Used by `_.template` to customize its `_.assign` use.
     *
     * **Note:** This function is like `assignDefaults` except that it ignores
     * inherited property values when checking if a property is `undefined`.
     *
     * @private
     * @param {*} objectValue The destination object property value.
     * @param {*} sourceValue The source object property value.
     * @param {string} key The key associated with the object and source values.
     * @param {Object} object The destination object.
     * @returns {*} Returns the value to assign to the destination object.
     */
    function assignOwnDefaults(objectValue, sourceValue, key, object) {
      return (objectValue === undefined || !hasOwnProperty.call(object, key))
        ? sourceValue
        : objectValue;
    }

    /**
     * A specialized version of `_.assign` for customizing assigned values without
     * support for argument juggling, multiple sources, and `this` binding `customizer`
     * functions.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @param {Function} customizer The function to customize assigned values.
     * @returns {Object} Returns `object`.
     */
    function assignWith(object, source, customizer) {
      var index = -1,
          props = keys(source),
          length = props.length;

      while (++index < length) {
        var key = props[index],
            value = object[key],
            result = customizer(value, source[key], key, object, source);

        if ((result === result ? (result !== value) : (value === value)) ||
            (value === undefined && !(key in object))) {
          object[key] = result;
        }
      }
      return object;
    }

    /**
     * The base implementation of `_.assign` without support for argument juggling,
     * multiple sources, and `customizer` functions.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @returns {Object} Returns `object`.
     */
    function baseAssign(object, source) {
      return source == null
        ? object
        : baseCopy(source, keys(source), object);
    }

    /**
     * The base implementation of `_.at` without support for string collections
     * and individual key arguments.
     *
     * @private
     * @param {Array|Object} collection The collection to iterate over.
     * @param {number[]|string[]} props The property names or indexes of elements to pick.
     * @returns {Array} Returns the new array of picked elements.
     */
    function baseAt(collection, props) {
      var index = -1,
          isNil = collection == null,
          isArr = !isNil && isArrayLike(collection),
          length = isArr ? collection.length : 0,
          propsLength = props.length,
          result = Array(propsLength);

      while(++index < propsLength) {
        var key = props[index];
        if (isArr) {
          result[index] = isIndex(key, length) ? collection[key] : undefined;
        } else {
          result[index] = isNil ? undefined : collection[key];
        }
      }
      return result;
    }

    /**
     * Copies properties of `source` to `object`.
     *
     * @private
     * @param {Object} source The object to copy properties from.
     * @param {Array} props The property names to copy.
     * @param {Object} [object={}] The object to copy properties to.
     * @returns {Object} Returns `object`.
     */
    function baseCopy(source, props, object) {
      object || (object = {});

      var index = -1,
          length = props.length;

      while (++index < length) {
        var key = props[index];
        object[key] = source[key];
      }
      return object;
    }

    /**
     * The base implementation of `_.callback` which supports specifying the
     * number of arguments to provide to `func`.
     *
     * @private
     * @param {*} [func=_.identity] The value to convert to a callback.
     * @param {*} [thisArg] The `this` binding of `func`.
     * @param {number} [argCount] The number of arguments to provide to `func`.
     * @returns {Function} Returns the callback.
     */
    function baseCallback(func, thisArg, argCount) {
      var type = typeof func;
      if (type == 'function') {
        return thisArg === undefined
          ? func
          : bindCallback(func, thisArg, argCount);
      }
      if (func == null) {
        return identity;
      }
      if (type == 'object') {
        return baseMatches(func);
      }
      return thisArg === undefined
        ? property(func)
        : baseMatchesProperty(func, thisArg);
    }

    /**
     * The base implementation of `_.clone` without support for argument juggling
     * and `this` binding `customizer` functions.
     *
     * @private
     * @param {*} value The value to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @param {Function} [customizer] The function to customize cloning values.
     * @param {string} [key] The key of `value`.
     * @param {Object} [object] The object `value` belongs to.
     * @param {Array} [stackA=[]] Tracks traversed source objects.
     * @param {Array} [stackB=[]] Associates clones with source counterparts.
     * @returns {*} Returns the cloned value.
     */
    function baseClone(value, isDeep, customizer, key, object, stackA, stackB) {
      var result;
      if (customizer) {
        result = object ? customizer(value, key, object) : customizer(value);
      }
      if (result !== undefined) {
        return result;
      }
      if (!isObject(value)) {
        return value;
      }
      var isArr = isArray(value);
      if (isArr) {
        result = initCloneArray(value);
        if (!isDeep) {
          return arrayCopy(value, result);
        }
      } else {
        var tag = objToString.call(value),
            isFunc = tag == funcTag;

        if (tag == objectTag || tag == argsTag || (isFunc && !object)) {
          if (isHostObject(value)) {
            return object ? value : {};
          }
          result = initCloneObject(isFunc ? {} : value);
          if (!isDeep) {
            return baseAssign(result, value);
          }
        } else {
          return cloneableTags[tag]
            ? initCloneByTag(value, tag, isDeep)
            : (object ? value : {});
        }
      }
      // Check for circular references and return its corresponding clone.
      stackA || (stackA = []);
      stackB || (stackB = []);

      var length = stackA.length;
      while (length--) {
        if (stackA[length] == value) {
          return stackB[length];
        }
      }
      // Add the source value to the stack of traversed objects and associate it with its clone.
      stackA.push(value);
      stackB.push(result);

      // Recursively populate clone (susceptible to call stack limits).
      (isArr ? arrayEach : baseForOwn)(value, function(subValue, key) {
        result[key] = baseClone(subValue, isDeep, customizer, key, value, stackA, stackB);
      });
      return result;
    }

    /**
     * The base implementation of `_.create` without support for assigning
     * properties to the created object.
     *
     * @private
     * @param {Object} prototype The object to inherit from.
     * @returns {Object} Returns the new object.
     */
    var baseCreate = (function() {
      function object() {}
      return function(prototype) {
        if (isObject(prototype)) {
          object.prototype = prototype;
          var result = new object;
          object.prototype = undefined;
        }
        return result || {};
      };
    }());

    /**
     * The base implementation of `_.delay` and `_.defer` which accepts an index
     * of where to slice the arguments to provide to `func`.
     *
     * @private
     * @param {Function} func The function to delay.
     * @param {number} wait The number of milliseconds to delay invocation.
     * @param {Object} args The arguments provide to `func`.
     * @returns {number} Returns the timer id.
     */
    function baseDelay(func, wait, args) {
      if (typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      return setTimeout(function() { func.apply(undefined, args); }, wait);
    }

    /**
     * The base implementation of `_.difference` which accepts a single array
     * of values to exclude.
     *
     * @private
     * @param {Array} array The array to inspect.
     * @param {Array} values The values to exclude.
     * @returns {Array} Returns the new array of filtered values.
     */
    function baseDifference(array, values) {
      var length = array ? array.length : 0,
          result = [];

      if (!length) {
        return result;
      }
      var index = -1,
          indexOf = getIndexOf(),
          isCommon = indexOf === baseIndexOf,
          cache = (isCommon && values.length >= LARGE_ARRAY_SIZE) ? createCache(values) : null,
          valuesLength = values.length;

      if (cache) {
        indexOf = cacheIndexOf;
        isCommon = false;
        values = cache;
      }
      outer:
      while (++index < length) {
        var value = array[index];

        if (isCommon && value === value) {
          var valuesIndex = valuesLength;
          while (valuesIndex--) {
            if (values[valuesIndex] === value) {
              continue outer;
            }
          }
          result.push(value);
        }
        else if (indexOf(values, value, 0) < 0) {
          result.push(value);
        }
      }
      return result;
    }

    /**
     * The base implementation of `_.forEach` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array|Object|string} Returns `collection`.
     */
    var baseEach = createBaseEach(baseForOwn);

    /**
     * The base implementation of `_.forEachRight` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array|Object|string} Returns `collection`.
     */
    var baseEachRight = createBaseEach(baseForOwnRight, true);

    /**
     * The base implementation of `_.every` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {boolean} Returns `true` if all elements pass the predicate check,
     *  else `false`
     */
    function baseEvery(collection, predicate) {
      var result = true;
      baseEach(collection, function(value, index, collection) {
        result = !!predicate(value, index, collection);
        return result;
      });
      return result;
    }

    /**
     * Gets the extremum value of `collection` invoking `iteratee` for each value
     * in `collection` to generate the criterion by which the value is ranked.
     * The `iteratee` is invoked with three arguments: (value, index|key, collection).
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {Function} comparator The function used to compare values.
     * @param {*} exValue The initial extremum value.
     * @returns {*} Returns the extremum value.
     */
    function baseExtremum(collection, iteratee, comparator, exValue) {
      var computed = exValue,
          result = computed;

      baseEach(collection, function(value, index, collection) {
        var current = +iteratee(value, index, collection);
        if (comparator(current, computed) || (current === exValue && current === result)) {
          computed = current;
          result = value;
        }
      });
      return result;
    }

    /**
     * The base implementation of `_.fill` without an iteratee call guard.
     *
     * @private
     * @param {Array} array The array to fill.
     * @param {*} value The value to fill `array` with.
     * @param {number} [start=0] The start position.
     * @param {number} [end=array.length] The end position.
     * @returns {Array} Returns `array`.
     */
    function baseFill(array, value, start, end) {
      var length = array.length;

      start = start == null ? 0 : (+start || 0);
      if (start < 0) {
        start = -start > length ? 0 : (length + start);
      }
      end = (end === undefined || end > length) ? length : (+end || 0);
      if (end < 0) {
        end += length;
      }
      length = start > end ? 0 : (end >>> 0);
      start >>>= 0;

      while (start < length) {
        array[start++] = value;
      }
      return array;
    }

    /**
     * The base implementation of `_.filter` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {Array} Returns the new filtered array.
     */
    function baseFilter(collection, predicate) {
      var result = [];
      baseEach(collection, function(value, index, collection) {
        if (predicate(value, index, collection)) {
          result.push(value);
        }
      });
      return result;
    }

    /**
     * The base implementation of `_.find`, `_.findLast`, `_.findKey`, and `_.findLastKey`,
     * without support for callback shorthands and `this` binding, which iterates
     * over `collection` using the provided `eachFunc`.
     *
     * @private
     * @param {Array|Object|string} collection The collection to search.
     * @param {Function} predicate The function invoked per iteration.
     * @param {Function} eachFunc The function to iterate over `collection`.
     * @param {boolean} [retKey] Specify returning the key of the found element
     *  instead of the element itself.
     * @returns {*} Returns the found element or its key, else `undefined`.
     */
    function baseFind(collection, predicate, eachFunc, retKey) {
      var result;
      eachFunc(collection, function(value, key, collection) {
        if (predicate(value, key, collection)) {
          result = retKey ? key : value;
          return false;
        }
      });
      return result;
    }

    /**
     * The base implementation of `_.flatten` with added support for restricting
     * flattening and specifying the start index.
     *
     * @private
     * @param {Array} array The array to flatten.
     * @param {boolean} [isDeep] Specify a deep flatten.
     * @param {boolean} [isStrict] Restrict flattening to arrays-like objects.
     * @param {Array} [result=[]] The initial result value.
     * @returns {Array} Returns the new flattened array.
     */
    function baseFlatten(array, isDeep, isStrict, result) {
      result || (result = []);

      var index = -1,
          length = array.length;

      while (++index < length) {
        var value = array[index];
        if (isObjectLike(value) && isArrayLike(value) &&
            (isStrict || isArray(value) || isArguments(value))) {
          if (isDeep) {
            // Recursively flatten arrays (susceptible to call stack limits).
            baseFlatten(value, isDeep, isStrict, result);
          } else {
            arrayPush(result, value);
          }
        } else if (!isStrict) {
          result[result.length] = value;
        }
      }
      return result;
    }

    /**
     * The base implementation of `baseForIn` and `baseForOwn` which iterates
     * over `object` properties returned by `keysFunc` invoking `iteratee` for
     * each property. Iteratee functions may exit iteration early by explicitly
     * returning `false`.
     *
     * @private
     * @param {Object} object The object to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {Function} keysFunc The function to get the keys of `object`.
     * @returns {Object} Returns `object`.
     */
    var baseFor = createBaseFor();

    /**
     * This function is like `baseFor` except that it iterates over properties
     * in the opposite order.
     *
     * @private
     * @param {Object} object The object to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {Function} keysFunc The function to get the keys of `object`.
     * @returns {Object} Returns `object`.
     */
    var baseForRight = createBaseFor(true);

    /**
     * The base implementation of `_.forIn` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Object} object The object to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Object} Returns `object`.
     */
    function baseForIn(object, iteratee) {
      return baseFor(object, iteratee, keysIn);
    }

    /**
     * The base implementation of `_.forOwn` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Object} object The object to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Object} Returns `object`.
     */
    function baseForOwn(object, iteratee) {
      return baseFor(object, iteratee, keys);
    }

    /**
     * The base implementation of `_.forOwnRight` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Object} object The object to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Object} Returns `object`.
     */
    function baseForOwnRight(object, iteratee) {
      return baseForRight(object, iteratee, keys);
    }

    /**
     * The base implementation of `_.functions` which creates an array of
     * `object` function property names filtered from those provided.
     *
     * @private
     * @param {Object} object The object to inspect.
     * @param {Array} props The property names to filter.
     * @returns {Array} Returns the new array of filtered property names.
     */
    function baseFunctions(object, props) {
      var index = -1,
          length = props.length,
          resIndex = -1,
          result = [];

      while (++index < length) {
        var key = props[index];
        if (isFunction(object[key])) {
          result[++resIndex] = key;
        }
      }
      return result;
    }

    /**
     * The base implementation of `get` without support for string paths
     * and default values.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {Array} path The path of the property to get.
     * @param {string} [pathKey] The key representation of path.
     * @returns {*} Returns the resolved value.
     */
    function baseGet(object, path, pathKey) {
      if (object == null) {
        return;
      }
      object = toObject(object);
      if (pathKey !== undefined && pathKey in object) {
        path = [pathKey];
      }
      var index = 0,
          length = path.length;

      while (object != null && index < length) {
        object = toObject(object)[path[index++]];
      }
      return (index && index == length) ? object : undefined;
    }

    /**
     * The base implementation of `_.isEqual` without support for `this` binding
     * `customizer` functions.
     *
     * @private
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @param {Function} [customizer] The function to customize comparing values.
     * @param {boolean} [isLoose] Specify performing partial comparisons.
     * @param {Array} [stackA] Tracks traversed `value` objects.
     * @param {Array} [stackB] Tracks traversed `other` objects.
     * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
     */
    function baseIsEqual(value, other, customizer, isLoose, stackA, stackB) {
      if (value === other) {
        return true;
      }
      if (value == null || other == null || (!isObject(value) && !isObjectLike(other))) {
        return value !== value && other !== other;
      }
      return baseIsEqualDeep(value, other, baseIsEqual, customizer, isLoose, stackA, stackB);
    }

    /**
     * A specialized version of `baseIsEqual` for arrays and objects which performs
     * deep comparisons and tracks traversed objects enabling objects with circular
     * references to be compared.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Function} [customizer] The function to customize comparing objects.
     * @param {boolean} [isLoose] Specify performing partial comparisons.
     * @param {Array} [stackA=[]] Tracks traversed `value` objects.
     * @param {Array} [stackB=[]] Tracks traversed `other` objects.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */
    function baseIsEqualDeep(object, other, equalFunc, customizer, isLoose, stackA, stackB) {
      var objIsArr = isArray(object),
          othIsArr = isArray(other),
          objTag = arrayTag,
          othTag = arrayTag;

      if (!objIsArr) {
        objTag = objToString.call(object);
        if (objTag == argsTag) {
          objTag = objectTag;
        } else if (objTag != objectTag) {
          objIsArr = isTypedArray(object);
        }
      }
      if (!othIsArr) {
        othTag = objToString.call(other);
        if (othTag == argsTag) {
          othTag = objectTag;
        } else if (othTag != objectTag) {
          othIsArr = isTypedArray(other);
        }
      }
      var objIsObj = objTag == objectTag && !isHostObject(object),
          othIsObj = othTag == objectTag && !isHostObject(other),
          isSameTag = objTag == othTag;

      if (isSameTag && !(objIsArr || objIsObj)) {
        return equalByTag(object, other, objTag);
      }
      if (!isLoose) {
        var objIsWrapped = objIsObj && hasOwnProperty.call(object, '__wrapped__'),
            othIsWrapped = othIsObj && hasOwnProperty.call(other, '__wrapped__');

        if (objIsWrapped || othIsWrapped) {
          return equalFunc(objIsWrapped ? object.value() : object, othIsWrapped ? other.value() : other, customizer, isLoose, stackA, stackB);
        }
      }
      if (!isSameTag) {
        return false;
      }
      // Assume cyclic values are equal.
      // For more information on detecting circular references see https://es5.github.io/#JO.
      stackA || (stackA = []);
      stackB || (stackB = []);

      var length = stackA.length;
      while (length--) {
        if (stackA[length] == object) {
          return stackB[length] == other;
        }
      }
      // Add `object` and `other` to the stack of traversed objects.
      stackA.push(object);
      stackB.push(other);

      var result = (objIsArr ? equalArrays : equalObjects)(object, other, equalFunc, customizer, isLoose, stackA, stackB);

      stackA.pop();
      stackB.pop();

      return result;
    }

    /**
     * The base implementation of `_.isMatch` without support for callback
     * shorthands and `this` binding.
     *
     * @private
     * @param {Object} object The object to inspect.
     * @param {Array} matchData The propery names, values, and compare flags to match.
     * @param {Function} [customizer] The function to customize comparing objects.
     * @returns {boolean} Returns `true` if `object` is a match, else `false`.
     */
    function baseIsMatch(object, matchData, customizer) {
      var index = matchData.length,
          length = index,
          noCustomizer = !customizer;

      if (object == null) {
        return !length;
      }
      object = toObject(object);
      while (index--) {
        var data = matchData[index];
        if ((noCustomizer && data[2])
              ? data[1] !== object[data[0]]
              : !(data[0] in object)
            ) {
          return false;
        }
      }
      while (++index < length) {
        data = matchData[index];
        var key = data[0],
            objValue = object[key],
            srcValue = data[1];

        if (noCustomizer && data[2]) {
          if (objValue === undefined && !(key in object)) {
            return false;
          }
        } else {
          var result = customizer ? customizer(objValue, srcValue, key) : undefined;
          if (!(result === undefined ? baseIsEqual(srcValue, objValue, customizer, true) : result)) {
            return false;
          }
        }
      }
      return true;
    }

    /**
     * The base implementation of `_.map` without support for callback shorthands
     * and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {Array} Returns the new mapped array.
     */
    function baseMap(collection, iteratee) {
      var index = -1,
          result = isArrayLike(collection) ? Array(collection.length) : [];

      baseEach(collection, function(value, key, collection) {
        result[++index] = iteratee(value, key, collection);
      });
      return result;
    }

    /**
     * The base implementation of `_.matches` which does not clone `source`.
     *
     * @private
     * @param {Object} source The object of property values to match.
     * @returns {Function} Returns the new function.
     */
    function baseMatches(source) {
      var matchData = getMatchData(source);
      if (matchData.length == 1 && matchData[0][2]) {
        var key = matchData[0][0],
            value = matchData[0][1];

        return function(object) {
          if (object == null) {
            return false;
          }
          object = toObject(object);
          return object[key] === value && (value !== undefined || (key in object));
        };
      }
      return function(object) {
        return baseIsMatch(object, matchData);
      };
    }

    /**
     * The base implementation of `_.matchesProperty` which does not clone `srcValue`.
     *
     * @private
     * @param {string} path The path of the property to get.
     * @param {*} srcValue The value to compare.
     * @returns {Function} Returns the new function.
     */
    function baseMatchesProperty(path, srcValue) {
      var isArr = isArray(path),
          isCommon = isKey(path) && isStrictComparable(srcValue),
          pathKey = (path + '');

      path = toPath(path);
      return function(object) {
        if (object == null) {
          return false;
        }
        var key = pathKey;
        object = toObject(object);
        if ((isArr || !isCommon) && !(key in object)) {
          object = path.length == 1 ? object : baseGet(object, baseSlice(path, 0, -1));
          if (object == null) {
            return false;
          }
          key = last(path);
          object = toObject(object);
        }
        return object[key] === srcValue
          ? (srcValue !== undefined || (key in object))
          : baseIsEqual(srcValue, object[key], undefined, true);
      };
    }

    /**
     * The base implementation of `_.merge` without support for argument juggling,
     * multiple sources, and `this` binding `customizer` functions.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @param {Function} [customizer] The function to customize merged values.
     * @param {Array} [stackA=[]] Tracks traversed source objects.
     * @param {Array} [stackB=[]] Associates values with source counterparts.
     * @returns {Object} Returns `object`.
     */
    function baseMerge(object, source, customizer, stackA, stackB) {
      if (!isObject(object)) {
        return object;
      }
      var isSrcArr = isArrayLike(source) && (isArray(source) || isTypedArray(source)),
          props = isSrcArr ? undefined : keys(source);

      arrayEach(props || source, function(srcValue, key) {
        if (props) {
          key = srcValue;
          srcValue = source[key];
        }
        if (isObjectLike(srcValue)) {
          stackA || (stackA = []);
          stackB || (stackB = []);
          baseMergeDeep(object, source, key, baseMerge, customizer, stackA, stackB);
        }
        else {
          var value = object[key],
              result = customizer ? customizer(value, srcValue, key, object, source) : undefined,
              isCommon = result === undefined;

          if (isCommon) {
            result = srcValue;
          }
          if ((result !== undefined || (isSrcArr && !(key in object))) &&
              (isCommon || (result === result ? (result !== value) : (value === value)))) {
            object[key] = result;
          }
        }
      });
      return object;
    }

    /**
     * A specialized version of `baseMerge` for arrays and objects which performs
     * deep merges and tracks traversed objects enabling objects with circular
     * references to be merged.
     *
     * @private
     * @param {Object} object The destination object.
     * @param {Object} source The source object.
     * @param {string} key The key of the value to merge.
     * @param {Function} mergeFunc The function to merge values.
     * @param {Function} [customizer] The function to customize merged values.
     * @param {Array} [stackA=[]] Tracks traversed source objects.
     * @param {Array} [stackB=[]] Associates values with source counterparts.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */
    function baseMergeDeep(object, source, key, mergeFunc, customizer, stackA, stackB) {
      var length = stackA.length,
          srcValue = source[key];

      while (length--) {
        if (stackA[length] == srcValue) {
          object[key] = stackB[length];
          return;
        }
      }
      var value = object[key],
          result = customizer ? customizer(value, srcValue, key, object, source) : undefined,
          isCommon = result === undefined;

      if (isCommon) {
        result = srcValue;
        if (isArrayLike(srcValue) && (isArray(srcValue) || isTypedArray(srcValue))) {
          result = isArray(value)
            ? value
            : (isArrayLike(value) ? arrayCopy(value) : []);
        }
        else if (isPlainObject(srcValue) || isArguments(srcValue)) {
          result = isArguments(value)
            ? toPlainObject(value)
            : (isPlainObject(value) ? value : {});
        }
        else {
          isCommon = false;
        }
      }
      // Add the source value to the stack of traversed objects and associate
      // it with its merged value.
      stackA.push(srcValue);
      stackB.push(result);

      if (isCommon) {
        // Recursively merge objects and arrays (susceptible to call stack limits).
        object[key] = mergeFunc(result, srcValue, customizer, stackA, stackB);
      } else if (result === result ? (result !== value) : (value === value)) {
        object[key] = result;
      }
    }

    /**
     * The base implementation of `_.property` without support for deep paths.
     *
     * @private
     * @param {string} key The key of the property to get.
     * @returns {Function} Returns the new function.
     */
    function baseProperty(key) {
      return function(object) {
        return object == null ? undefined : toObject(object)[key];
      };
    }

    /**
     * A specialized version of `baseProperty` which supports deep paths.
     *
     * @private
     * @param {Array|string} path The path of the property to get.
     * @returns {Function} Returns the new function.
     */
    function basePropertyDeep(path) {
      var pathKey = (path + '');
      path = toPath(path);
      return function(object) {
        return baseGet(object, path, pathKey);
      };
    }

    /**
     * The base implementation of `_.pullAt` without support for individual
     * index arguments and capturing the removed elements.
     *
     * @private
     * @param {Array} array The array to modify.
     * @param {number[]} indexes The indexes of elements to remove.
     * @returns {Array} Returns `array`.
     */
    function basePullAt(array, indexes) {
      var length = array ? indexes.length : 0;
      while (length--) {
        var index = indexes[length];
        if (index != previous && isIndex(index)) {
          var previous = index;
          splice.call(array, index, 1);
        }
      }
      return array;
    }

    /**
     * The base implementation of `_.random` without support for argument juggling
     * and returning floating-point numbers.
     *
     * @private
     * @param {number} min The minimum possible value.
     * @param {number} max The maximum possible value.
     * @returns {number} Returns the random number.
     */
    function baseRandom(min, max) {
      return min + nativeFloor(nativeRandom() * (max - min + 1));
    }

    /**
     * The base implementation of `_.reduce` and `_.reduceRight` without support
     * for callback shorthands and `this` binding, which iterates over `collection`
     * using the provided `eachFunc`.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {*} accumulator The initial value.
     * @param {boolean} initFromCollection Specify using the first or last element
     *  of `collection` as the initial value.
     * @param {Function} eachFunc The function to iterate over `collection`.
     * @returns {*} Returns the accumulated value.
     */
    function baseReduce(collection, iteratee, accumulator, initFromCollection, eachFunc) {
      eachFunc(collection, function(value, index, collection) {
        accumulator = initFromCollection
          ? (initFromCollection = false, value)
          : iteratee(accumulator, value, index, collection);
      });
      return accumulator;
    }

    /**
     * The base implementation of `setData` without support for hot loop detection.
     *
     * @private
     * @param {Function} func The function to associate metadata with.
     * @param {*} data The metadata.
     * @returns {Function} Returns `func`.
     */
    var baseSetData = !metaMap ? identity : function(func, data) {
      metaMap.set(func, data);
      return func;
    };

    /**
     * The base implementation of `_.slice` without an iteratee call guard.
     *
     * @private
     * @param {Array} array The array to slice.
     * @param {number} [start=0] The start position.
     * @param {number} [end=array.length] The end position.
     * @returns {Array} Returns the slice of `array`.
     */
    function baseSlice(array, start, end) {
      var index = -1,
          length = array.length;

      start = start == null ? 0 : (+start || 0);
      if (start < 0) {
        start = -start > length ? 0 : (length + start);
      }
      end = (end === undefined || end > length) ? length : (+end || 0);
      if (end < 0) {
        end += length;
      }
      length = start > end ? 0 : ((end - start) >>> 0);
      start >>>= 0;

      var result = Array(length);
      while (++index < length) {
        result[index] = array[index + start];
      }
      return result;
    }

    /**
     * The base implementation of `_.some` without support for callback shorthands
     * and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {boolean} Returns `true` if any element passes the predicate check,
     *  else `false`.
     */
    function baseSome(collection, predicate) {
      var result;

      baseEach(collection, function(value, index, collection) {
        result = predicate(value, index, collection);
        return !result;
      });
      return !!result;
    }

    /**
     * The base implementation of `_.sortBy` which uses `comparer` to define
     * the sort order of `array` and replaces criteria objects with their
     * corresponding values.
     *
     * @private
     * @param {Array} array The array to sort.
     * @param {Function} comparer The function to define sort order.
     * @returns {Array} Returns `array`.
     */
    function baseSortBy(array, comparer) {
      var length = array.length;

      array.sort(comparer);
      while (length--) {
        array[length] = array[length].value;
      }
      return array;
    }

    /**
     * The base implementation of `_.sortByOrder` without param guards.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function[]|Object[]|string[]} iteratees The iteratees to sort by.
     * @param {boolean[]} orders The sort orders of `iteratees`.
     * @returns {Array} Returns the new sorted array.
     */
    function baseSortByOrder(collection, iteratees, orders) {
      var callback = getCallback(),
          index = -1;

      iteratees = arrayMap(iteratees, function(iteratee) { return callback(iteratee); });

      var result = baseMap(collection, function(value) {
        var criteria = arrayMap(iteratees, function(iteratee) { return iteratee(value); });
        return { 'criteria': criteria, 'index': ++index, 'value': value };
      });

      return baseSortBy(result, function(object, other) {
        return compareMultiple(object, other, orders);
      });
    }

    /**
     * The base implementation of `_.sum` without support for callback shorthands
     * and `this` binding.
     *
     * @private
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} iteratee The function invoked per iteration.
     * @returns {number} Returns the sum.
     */
    function baseSum(collection, iteratee) {
      var result = 0;
      baseEach(collection, function(value, index, collection) {
        result += +iteratee(value, index, collection) || 0;
      });
      return result;
    }

    /**
     * The base implementation of `_.uniq` without support for callback shorthands
     * and `this` binding.
     *
     * @private
     * @param {Array} array The array to inspect.
     * @param {Function} [iteratee] The function invoked per iteration.
     * @returns {Array} Returns the new duplicate free array.
     */
    function baseUniq(array, iteratee) {
      var index = -1,
          indexOf = getIndexOf(),
          length = array.length,
          isCommon = indexOf === baseIndexOf,
          isLarge = isCommon && length >= LARGE_ARRAY_SIZE,
          seen = isLarge ? createCache() : null,
          result = [];

      if (seen) {
        indexOf = cacheIndexOf;
        isCommon = false;
      } else {
        isLarge = false;
        seen = iteratee ? [] : result;
      }
      outer:
      while (++index < length) {
        var value = array[index],
            computed = iteratee ? iteratee(value, index, array) : value;

        if (isCommon && value === value) {
          var seenIndex = seen.length;
          while (seenIndex--) {
            if (seen[seenIndex] === computed) {
              continue outer;
            }
          }
          if (iteratee) {
            seen.push(computed);
          }
          result.push(value);
        }
        else if (indexOf(seen, computed, 0) < 0) {
          if (iteratee || isLarge) {
            seen.push(computed);
          }
          result.push(value);
        }
      }
      return result;
    }

    /**
     * The base implementation of `_.values` and `_.valuesIn` which creates an
     * array of `object` property values corresponding to the property names
     * of `props`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {Array} props The property names to get values for.
     * @returns {Object} Returns the array of property values.
     */
    function baseValues(object, props) {
      var index = -1,
          length = props.length,
          result = Array(length);

      while (++index < length) {
        result[index] = object[props[index]];
      }
      return result;
    }

    /**
     * The base implementation of `_.dropRightWhile`, `_.dropWhile`, `_.takeRightWhile`,
     * and `_.takeWhile` without support for callback shorthands and `this` binding.
     *
     * @private
     * @param {Array} array The array to query.
     * @param {Function} predicate The function invoked per iteration.
     * @param {boolean} [isDrop] Specify dropping elements instead of taking them.
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Array} Returns the slice of `array`.
     */
    function baseWhile(array, predicate, isDrop, fromRight) {
      var length = array.length,
          index = fromRight ? length : -1;

      while ((fromRight ? index-- : ++index < length) && predicate(array[index], index, array)) {}
      return isDrop
        ? baseSlice(array, (fromRight ? 0 : index), (fromRight ? index + 1 : length))
        : baseSlice(array, (fromRight ? index + 1 : 0), (fromRight ? length : index));
    }

    /**
     * The base implementation of `wrapperValue` which returns the result of
     * performing a sequence of actions on the unwrapped `value`, where each
     * successive action is supplied the return value of the previous.
     *
     * @private
     * @param {*} value The unwrapped value.
     * @param {Array} actions Actions to peform to resolve the unwrapped value.
     * @returns {*} Returns the resolved value.
     */
    function baseWrapperValue(value, actions) {
      var result = value;
      if (result instanceof LazyWrapper) {
        result = result.value();
      }
      var index = -1,
          length = actions.length;

      while (++index < length) {
        var action = actions[index];
        result = action.func.apply(action.thisArg, arrayPush([result], action.args));
      }
      return result;
    }

    /**
     * Performs a binary search of `array` to determine the index at which `value`
     * should be inserted into `array` in order to maintain its sort order.
     *
     * @private
     * @param {Array} array The sorted array to inspect.
     * @param {*} value The value to evaluate.
     * @param {boolean} [retHighest] Specify returning the highest qualified index.
     * @returns {number} Returns the index at which `value` should be inserted
     *  into `array`.
     */
    function binaryIndex(array, value, retHighest) {
      var low = 0,
          high = array ? array.length : low;

      if (typeof value == 'number' && value === value && high <= HALF_MAX_ARRAY_LENGTH) {
        while (low < high) {
          var mid = (low + high) >>> 1,
              computed = array[mid];

          if ((retHighest ? (computed <= value) : (computed < value)) && computed !== null) {
            low = mid + 1;
          } else {
            high = mid;
          }
        }
        return high;
      }
      return binaryIndexBy(array, value, identity, retHighest);
    }

    /**
     * This function is like `binaryIndex` except that it invokes `iteratee` for
     * `value` and each element of `array` to compute their sort ranking. The
     * iteratee is invoked with one argument; (value).
     *
     * @private
     * @param {Array} array The sorted array to inspect.
     * @param {*} value The value to evaluate.
     * @param {Function} iteratee The function invoked per iteration.
     * @param {boolean} [retHighest] Specify returning the highest qualified index.
     * @returns {number} Returns the index at which `value` should be inserted
     *  into `array`.
     */
    function binaryIndexBy(array, value, iteratee, retHighest) {
      value = iteratee(value);

      var low = 0,
          high = array ? array.length : 0,
          valIsNaN = value !== value,
          valIsNull = value === null,
          valIsUndef = value === undefined;

      while (low < high) {
        var mid = nativeFloor((low + high) / 2),
            computed = iteratee(array[mid]),
            isDef = computed !== undefined,
            isReflexive = computed === computed;

        if (valIsNaN) {
          var setLow = isReflexive || retHighest;
        } else if (valIsNull) {
          setLow = isReflexive && isDef && (retHighest || computed != null);
        } else if (valIsUndef) {
          setLow = isReflexive && (retHighest || isDef);
        } else if (computed == null) {
          setLow = false;
        } else {
          setLow = retHighest ? (computed <= value) : (computed < value);
        }
        if (setLow) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      return nativeMin(high, MAX_ARRAY_INDEX);
    }

    /**
     * A specialized version of `baseCallback` which only supports `this` binding
     * and specifying the number of arguments to provide to `func`.
     *
     * @private
     * @param {Function} func The function to bind.
     * @param {*} thisArg The `this` binding of `func`.
     * @param {number} [argCount] The number of arguments to provide to `func`.
     * @returns {Function} Returns the callback.
     */
    function bindCallback(func, thisArg, argCount) {
      if (typeof func != 'function') {
        return identity;
      }
      if (thisArg === undefined) {
        return func;
      }
      switch (argCount) {
        case 1: return function(value) {
          return func.call(thisArg, value);
        };
        case 3: return function(value, index, collection) {
          return func.call(thisArg, value, index, collection);
        };
        case 4: return function(accumulator, value, index, collection) {
          return func.call(thisArg, accumulator, value, index, collection);
        };
        case 5: return function(value, other, key, object, source) {
          return func.call(thisArg, value, other, key, object, source);
        };
      }
      return function() {
        return func.apply(thisArg, arguments);
      };
    }

    /**
     * Creates a clone of the given array buffer.
     *
     * @private
     * @param {ArrayBuffer} buffer The array buffer to clone.
     * @returns {ArrayBuffer} Returns the cloned array buffer.
     */
    function bufferClone(buffer) {
      var result = new ArrayBuffer(buffer.byteLength),
          view = new Uint8Array(result);

      view.set(new Uint8Array(buffer));
      return result;
    }

    /**
     * Creates an array that is the composition of partially applied arguments,
     * placeholders, and provided arguments into a single array of arguments.
     *
     * @private
     * @param {Array|Object} args The provided arguments.
     * @param {Array} partials The arguments to prepend to those provided.
     * @param {Array} holders The `partials` placeholder indexes.
     * @returns {Array} Returns the new array of composed arguments.
     */
    function composeArgs(args, partials, holders) {
      var holdersLength = holders.length,
          argsIndex = -1,
          argsLength = nativeMax(args.length - holdersLength, 0),
          leftIndex = -1,
          leftLength = partials.length,
          result = Array(leftLength + argsLength);

      while (++leftIndex < leftLength) {
        result[leftIndex] = partials[leftIndex];
      }
      while (++argsIndex < holdersLength) {
        result[holders[argsIndex]] = args[argsIndex];
      }
      while (argsLength--) {
        result[leftIndex++] = args[argsIndex++];
      }
      return result;
    }

    /**
     * This function is like `composeArgs` except that the arguments composition
     * is tailored for `_.partialRight`.
     *
     * @private
     * @param {Array|Object} args The provided arguments.
     * @param {Array} partials The arguments to append to those provided.
     * @param {Array} holders The `partials` placeholder indexes.
     * @returns {Array} Returns the new array of composed arguments.
     */
    function composeArgsRight(args, partials, holders) {
      var holdersIndex = -1,
          holdersLength = holders.length,
          argsIndex = -1,
          argsLength = nativeMax(args.length - holdersLength, 0),
          rightIndex = -1,
          rightLength = partials.length,
          result = Array(argsLength + rightLength);

      while (++argsIndex < argsLength) {
        result[argsIndex] = args[argsIndex];
      }
      var offset = argsIndex;
      while (++rightIndex < rightLength) {
        result[offset + rightIndex] = partials[rightIndex];
      }
      while (++holdersIndex < holdersLength) {
        result[offset + holders[holdersIndex]] = args[argsIndex++];
      }
      return result;
    }

    /**
     * Creates a `_.countBy`, `_.groupBy`, `_.indexBy`, or `_.partition` function.
     *
     * @private
     * @param {Function} setter The function to set keys and values of the accumulator object.
     * @param {Function} [initializer] The function to initialize the accumulator object.
     * @returns {Function} Returns the new aggregator function.
     */
    function createAggregator(setter, initializer) {
      return function(collection, iteratee, thisArg) {
        var result = initializer ? initializer() : {};
        iteratee = getCallback(iteratee, thisArg, 3);

        if (isArray(collection)) {
          var index = -1,
              length = collection.length;

          while (++index < length) {
            var value = collection[index];
            setter(result, value, iteratee(value, index, collection), collection);
          }
        } else {
          baseEach(collection, function(value, key, collection) {
            setter(result, value, iteratee(value, key, collection), collection);
          });
        }
        return result;
      };
    }

    /**
     * Creates a `_.assign`, `_.defaults`, or `_.merge` function.
     *
     * @private
     * @param {Function} assigner The function to assign values.
     * @returns {Function} Returns the new assigner function.
     */
    function createAssigner(assigner) {
      return restParam(function(object, sources) {
        var index = -1,
            length = object == null ? 0 : sources.length,
            customizer = length > 2 ? sources[length - 2] : undefined,
            guard = length > 2 ? sources[2] : undefined,
            thisArg = length > 1 ? sources[length - 1] : undefined;

        if (typeof customizer == 'function') {
          customizer = bindCallback(customizer, thisArg, 5);
          length -= 2;
        } else {
          customizer = typeof thisArg == 'function' ? thisArg : undefined;
          length -= (customizer ? 1 : 0);
        }
        if (guard && isIterateeCall(sources[0], sources[1], guard)) {
          customizer = length < 3 ? undefined : customizer;
          length = 1;
        }
        while (++index < length) {
          var source = sources[index];
          if (source) {
            assigner(object, source, customizer);
          }
        }
        return object;
      });
    }

    /**
     * Creates a `baseEach` or `baseEachRight` function.
     *
     * @private
     * @param {Function} eachFunc The function to iterate over a collection.
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Function} Returns the new base function.
     */
    function createBaseEach(eachFunc, fromRight) {
      return function(collection, iteratee) {
        var length = collection ? getLength(collection) : 0;
        if (!isLength(length)) {
          return eachFunc(collection, iteratee);
        }
        var index = fromRight ? length : -1,
            iterable = toObject(collection);

        while ((fromRight ? index-- : ++index < length)) {
          if (iteratee(iterable[index], index, iterable) === false) {
            break;
          }
        }
        return collection;
      };
    }

    /**
     * Creates a base function for `_.forIn` or `_.forInRight`.
     *
     * @private
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Function} Returns the new base function.
     */
    function createBaseFor(fromRight) {
      return function(object, iteratee, keysFunc) {
        var iterable = toObject(object),
            props = keysFunc(object),
            length = props.length,
            index = fromRight ? length : -1;

        while ((fromRight ? index-- : ++index < length)) {
          var key = props[index];
          if (iteratee(iterable[key], key, iterable) === false) {
            break;
          }
        }
        return object;
      };
    }

    /**
     * Creates a function that wraps `func` and invokes it with the `this`
     * binding of `thisArg`.
     *
     * @private
     * @param {Function} func The function to bind.
     * @param {*} [thisArg] The `this` binding of `func`.
     * @returns {Function} Returns the new bound function.
     */
    function createBindWrapper(func, thisArg) {
      var Ctor = createCtorWrapper(func);

      function wrapper() {
        var fn = (this && this !== root && this instanceof wrapper) ? Ctor : func;
        return fn.apply(thisArg, arguments);
      }
      return wrapper;
    }

    /**
     * Creates a `Set` cache object to optimize linear searches of large arrays.
     *
     * @private
     * @param {Array} [values] The values to cache.
     * @returns {null|Object} Returns the new cache object if `Set` is supported, else `null`.
     */
    function createCache(values) {
      return (nativeCreate && Set) ? new SetCache(values) : null;
    }

    /**
     * Creates a function that produces compound words out of the words in a
     * given string.
     *
     * @private
     * @param {Function} callback The function to combine each word.
     * @returns {Function} Returns the new compounder function.
     */
    function createCompounder(callback) {
      return function(string) {
        var index = -1,
            array = words(deburr(string)),
            length = array.length,
            result = '';

        while (++index < length) {
          result = callback(result, array[index], index);
        }
        return result;
      };
    }

    /**
     * Creates a function that produces an instance of `Ctor` regardless of
     * whether it was invoked as part of a `new` expression or by `call` or `apply`.
     *
     * @private
     * @param {Function} Ctor The constructor to wrap.
     * @returns {Function} Returns the new wrapped function.
     */
    function createCtorWrapper(Ctor) {
      return function() {
        // Use a `switch` statement to work with class constructors.
        // See http://ecma-international.org/ecma-262/6.0/#sec-ecmascript-function-objects-call-thisargument-argumentslist
        // for more details.
        var args = arguments;
        switch (args.length) {
          case 0: return new Ctor;
          case 1: return new Ctor(args[0]);
          case 2: return new Ctor(args[0], args[1]);
          case 3: return new Ctor(args[0], args[1], args[2]);
          case 4: return new Ctor(args[0], args[1], args[2], args[3]);
          case 5: return new Ctor(args[0], args[1], args[2], args[3], args[4]);
          case 6: return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5]);
          case 7: return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
        }
        var thisBinding = baseCreate(Ctor.prototype),
            result = Ctor.apply(thisBinding, args);

        // Mimic the constructor's `return` behavior.
        // See https://es5.github.io/#x13.2.2 for more details.
        return isObject(result) ? result : thisBinding;
      };
    }

    /**
     * Creates a `_.curry` or `_.curryRight` function.
     *
     * @private
     * @param {boolean} flag The curry bit flag.
     * @returns {Function} Returns the new curry function.
     */
    function createCurry(flag) {
      function curryFunc(func, arity, guard) {
        if (guard && isIterateeCall(func, arity, guard)) {
          arity = undefined;
        }
        var result = createWrapper(func, flag, undefined, undefined, undefined, undefined, undefined, arity);
        result.placeholder = curryFunc.placeholder;
        return result;
      }
      return curryFunc;
    }

    /**
     * Creates a `_.defaults` or `_.defaultsDeep` function.
     *
     * @private
     * @param {Function} assigner The function to assign values.
     * @param {Function} customizer The function to customize assigned values.
     * @returns {Function} Returns the new defaults function.
     */
    function createDefaults(assigner, customizer) {
      return restParam(function(args) {
        var object = args[0];
        if (object == null) {
          return object;
        }
        args.push(customizer);
        return assigner.apply(undefined, args);
      });
    }

    /**
     * Creates a `_.max` or `_.min` function.
     *
     * @private
     * @param {Function} comparator The function used to compare values.
     * @param {*} exValue The initial extremum value.
     * @returns {Function} Returns the new extremum function.
     */
    function createExtremum(comparator, exValue) {
      return function(collection, iteratee, thisArg) {
        if (thisArg && isIterateeCall(collection, iteratee, thisArg)) {
          iteratee = undefined;
        }
        iteratee = getCallback(iteratee, thisArg, 3);
        if (iteratee.length == 1) {
          collection = isArray(collection) ? collection : toIterable(collection);
          var result = arrayExtremum(collection, iteratee, comparator, exValue);
          if (!(collection.length && result === exValue)) {
            return result;
          }
        }
        return baseExtremum(collection, iteratee, comparator, exValue);
      };
    }

    /**
     * Creates a `_.find` or `_.findLast` function.
     *
     * @private
     * @param {Function} eachFunc The function to iterate over a collection.
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Function} Returns the new find function.
     */
    function createFind(eachFunc, fromRight) {
      return function(collection, predicate, thisArg) {
        predicate = getCallback(predicate, thisArg, 3);
        if (isArray(collection)) {
          var index = baseFindIndex(collection, predicate, fromRight);
          return index > -1 ? collection[index] : undefined;
        }
        return baseFind(collection, predicate, eachFunc);
      };
    }

    /**
     * Creates a `_.findIndex` or `_.findLastIndex` function.
     *
     * @private
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Function} Returns the new find function.
     */
    function createFindIndex(fromRight) {
      return function(array, predicate, thisArg) {
        if (!(array && array.length)) {
          return -1;
        }
        predicate = getCallback(predicate, thisArg, 3);
        return baseFindIndex(array, predicate, fromRight);
      };
    }

    /**
     * Creates a `_.findKey` or `_.findLastKey` function.
     *
     * @private
     * @param {Function} objectFunc The function to iterate over an object.
     * @returns {Function} Returns the new find function.
     */
    function createFindKey(objectFunc) {
      return function(object, predicate, thisArg) {
        predicate = getCallback(predicate, thisArg, 3);
        return baseFind(object, predicate, objectFunc, true);
      };
    }

    /**
     * Creates a `_.flow` or `_.flowRight` function.
     *
     * @private
     * @param {boolean} [fromRight] Specify iterating from right to left.
     * @returns {Function} Returns the new flow function.
     */
    function createFlow(fromRight) {
      return function() {
        var wrapper,
            length = arguments.length,
            index = fromRight ? length : -1,
            leftIndex = 0,
            funcs = Array(length);

        while ((fromRight ? index-- : ++index < length)) {
          var func = funcs[leftIndex++] = arguments[index];
          if (typeof func != 'function') {
            throw new TypeError(FUNC_ERROR_TEXT);
          }
          if (!wrapper && LodashWrapper.prototype.thru && getFuncName(func) == 'wrapper') {
            wrapper = new LodashWrapper([], true);
          }
        }
        index = wrapper ? -1 : length;
        while (++index < length) {
          func = funcs[index];

          var funcName = getFuncName(func),
              data = funcName == 'wrapper' ? getData(func) : undefined;

          if (data && isLaziable(data[0]) && data[1] == (ARY_FLAG | CURRY_FLAG | PARTIAL_FLAG | REARG_FLAG) && !data[4].length && data[9] == 1) {
            wrapper = wrapper[getFuncName(data[0])].apply(wrapper, data[3]);
          } else {
            wrapper = (func.length == 1 && isLaziable(func)) ? wrapper[funcName]() : wrapper.thru(func);
          }
        }
        return function() {
          var args = arguments,
              value = args[0];

          if (wrapper && args.length == 1 && isArray(value) && value.length >= LARGE_ARRAY_SIZE) {
            return wrapper.plant(value).value();
          }
          var index = 0,
              result = length ? funcs[index].apply(this, args) : value;

          while (++index < length) {
            result = funcs[index].call(this, result);
          }
          return result;
        };
      };
    }

    /**
     * Creates a function for `_.forEach` or `_.forEachRight`.
     *
     * @private
     * @param {Function} arrayFunc The function to iterate over an array.
     * @param {Function} eachFunc The function to iterate over a collection.
     * @returns {Function} Returns the new each function.
     */
    function createForEach(arrayFunc, eachFunc) {
      return function(collection, iteratee, thisArg) {
        return (typeof iteratee == 'function' && thisArg === undefined && isArray(collection))
          ? arrayFunc(collection, iteratee)
          : eachFunc(collection, bindCallback(iteratee, thisArg, 3));
      };
    }

    /**
     * Creates a function for `_.forIn` or `_.forInRight`.
     *
     * @private
     * @param {Function} objectFunc The function to iterate over an object.
     * @returns {Function} Returns the new each function.
     */
    function createForIn(objectFunc) {
      return function(object, iteratee, thisArg) {
        if (typeof iteratee != 'function' || thisArg !== undefined) {
          iteratee = bindCallback(iteratee, thisArg, 3);
        }
        return objectFunc(object, iteratee, keysIn);
      };
    }

    /**
     * Creates a function for `_.forOwn` or `_.forOwnRight`.
     *
     * @private
     * @param {Function} objectFunc The function to iterate over an object.
     * @returns {Function} Returns the new each function.
     */
    function createForOwn(objectFunc) {
      return function(object, iteratee, thisArg) {
        if (typeof iteratee != 'function' || thisArg !== undefined) {
          iteratee = bindCallback(iteratee, thisArg, 3);
        }
        return objectFunc(object, iteratee);
      };
    }

    /**
     * Creates a function for `_.mapKeys` or `_.mapValues`.
     *
     * @private
     * @param {boolean} [isMapKeys] Specify mapping keys instead of values.
     * @returns {Function} Returns the new map function.
     */
    function createObjectMapper(isMapKeys) {
      return function(object, iteratee, thisArg) {
        var result = {};
        iteratee = getCallback(iteratee, thisArg, 3);

        baseForOwn(object, function(value, key, object) {
          var mapped = iteratee(value, key, object);
          key = isMapKeys ? mapped : key;
          value = isMapKeys ? value : mapped;
          result[key] = value;
        });
        return result;
      };
    }

    /**
     * Creates a function for `_.padLeft` or `_.padRight`.
     *
     * @private
     * @param {boolean} [fromRight] Specify padding from the right.
     * @returns {Function} Returns the new pad function.
     */
    function createPadDir(fromRight) {
      return function(string, length, chars) {
        string = baseToString(string);
        return (fromRight ? string : '') + createPadding(string, length, chars) + (fromRight ? '' : string);
      };
    }

    /**
     * Creates a `_.partial` or `_.partialRight` function.
     *
     * @private
     * @param {boolean} flag The partial bit flag.
     * @returns {Function} Returns the new partial function.
     */
    function createPartial(flag) {
      var partialFunc = restParam(function(func, partials) {
        var holders = replaceHolders(partials, partialFunc.placeholder);
        return createWrapper(func, flag, undefined, partials, holders);
      });
      return partialFunc;
    }

    /**
     * Creates a function for `_.reduce` or `_.reduceRight`.
     *
     * @private
     * @param {Function} arrayFunc The function to iterate over an array.
     * @param {Function} eachFunc The function to iterate over a collection.
     * @returns {Function} Returns the new each function.
     */
    function createReduce(arrayFunc, eachFunc) {
      return function(collection, iteratee, accumulator, thisArg) {
        var initFromArray = arguments.length < 3;
        return (typeof iteratee == 'function' && thisArg === undefined && isArray(collection))
          ? arrayFunc(collection, iteratee, accumulator, initFromArray)
          : baseReduce(collection, getCallback(iteratee, thisArg, 4), accumulator, initFromArray, eachFunc);
      };
    }

    /**
     * Creates a function that wraps `func` and invokes it with optional `this`
     * binding of, partial application, and currying.
     *
     * @private
     * @param {Function|string} func The function or method name to reference.
     * @param {number} bitmask The bitmask of flags. See `createWrapper` for more details.
     * @param {*} [thisArg] The `this` binding of `func`.
     * @param {Array} [partials] The arguments to prepend to those provided to the new function.
     * @param {Array} [holders] The `partials` placeholder indexes.
     * @param {Array} [partialsRight] The arguments to append to those provided to the new function.
     * @param {Array} [holdersRight] The `partialsRight` placeholder indexes.
     * @param {Array} [argPos] The argument positions of the new function.
     * @param {number} [ary] The arity cap of `func`.
     * @param {number} [arity] The arity of `func`.
     * @returns {Function} Returns the new wrapped function.
     */
    function createHybridWrapper(func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary, arity) {
      var isAry = bitmask & ARY_FLAG,
          isBind = bitmask & BIND_FLAG,
          isBindKey = bitmask & BIND_KEY_FLAG,
          isCurry = bitmask & CURRY_FLAG,
          isCurryBound = bitmask & CURRY_BOUND_FLAG,
          isCurryRight = bitmask & CURRY_RIGHT_FLAG,
          Ctor = isBindKey ? undefined : createCtorWrapper(func);

      function wrapper() {
        // Avoid `arguments` object use disqualifying optimizations by
        // converting it to an array before providing it to other functions.
        var length = arguments.length,
            index = length,
            args = Array(length);

        while (index--) {
          args[index] = arguments[index];
        }
        if (partials) {
          args = composeArgs(args, partials, holders);
        }
        if (partialsRight) {
          args = composeArgsRight(args, partialsRight, holdersRight);
        }
        if (isCurry || isCurryRight) {
          var placeholder = wrapper.placeholder,
              argsHolders = replaceHolders(args, placeholder);

          length -= argsHolders.length;
          if (length < arity) {
            var newArgPos = argPos ? arrayCopy(argPos) : undefined,
                newArity = nativeMax(arity - length, 0),
                newsHolders = isCurry ? argsHolders : undefined,
                newHoldersRight = isCurry ? undefined : argsHolders,
                newPartials = isCurry ? args : undefined,
                newPartialsRight = isCurry ? undefined : args;

            bitmask |= (isCurry ? PARTIAL_FLAG : PARTIAL_RIGHT_FLAG);
            bitmask &= ~(isCurry ? PARTIAL_RIGHT_FLAG : PARTIAL_FLAG);

            if (!isCurryBound) {
              bitmask &= ~(BIND_FLAG | BIND_KEY_FLAG);
            }
            var newData = [func, bitmask, thisArg, newPartials, newsHolders, newPartialsRight, newHoldersRight, newArgPos, ary, newArity],
                result = createHybridWrapper.apply(undefined, newData);

            if (isLaziable(func)) {
              setData(result, newData);
            }
            result.placeholder = placeholder;
            return result;
          }
        }
        var thisBinding = isBind ? thisArg : this,
            fn = isBindKey ? thisBinding[func] : func;

        if (argPos) {
          args = reorder(args, argPos);
        }
        if (isAry && ary < args.length) {
          args.length = ary;
        }
        if (this && this !== root && this instanceof wrapper) {
          fn = Ctor || createCtorWrapper(func);
        }
        return fn.apply(thisBinding, args);
      }
      return wrapper;
    }

    /**
     * Creates the padding required for `string` based on the given `length`.
     * The `chars` string is truncated if the number of characters exceeds `length`.
     *
     * @private
     * @param {string} string The string to create padding for.
     * @param {number} [length=0] The padding length.
     * @param {string} [chars=' '] The string used as padding.
     * @returns {string} Returns the pad for `string`.
     */
    function createPadding(string, length, chars) {
      var strLength = string.length;
      length = +length;

      if (strLength >= length || !nativeIsFinite(length)) {
        return '';
      }
      var padLength = length - strLength;
      chars = chars == null ? ' ' : (chars + '');
      return repeat(chars, nativeCeil(padLength / chars.length)).slice(0, padLength);
    }

    /**
     * Creates a function that wraps `func` and invokes it with the optional `this`
     * binding of `thisArg` and the `partials` prepended to those provided to
     * the wrapper.
     *
     * @private
     * @param {Function} func The function to partially apply arguments to.
     * @param {number} bitmask The bitmask of flags. See `createWrapper` for more details.
     * @param {*} thisArg The `this` binding of `func`.
     * @param {Array} partials The arguments to prepend to those provided to the new function.
     * @returns {Function} Returns the new bound function.
     */
    function createPartialWrapper(func, bitmask, thisArg, partials) {
      var isBind = bitmask & BIND_FLAG,
          Ctor = createCtorWrapper(func);

      function wrapper() {
        // Avoid `arguments` object use disqualifying optimizations by
        // converting it to an array before providing it `func`.
        var argsIndex = -1,
            argsLength = arguments.length,
            leftIndex = -1,
            leftLength = partials.length,
            args = Array(leftLength + argsLength);

        while (++leftIndex < leftLength) {
          args[leftIndex] = partials[leftIndex];
        }
        while (argsLength--) {
          args[leftIndex++] = arguments[++argsIndex];
        }
        var fn = (this && this !== root && this instanceof wrapper) ? Ctor : func;
        return fn.apply(isBind ? thisArg : this, args);
      }
      return wrapper;
    }

    /**
     * Creates a `_.ceil`, `_.floor`, or `_.round` function.
     *
     * @private
     * @param {string} methodName The name of the `Math` method to use when rounding.
     * @returns {Function} Returns the new round function.
     */
    function createRound(methodName) {
      var func = Math[methodName];
      return function(number, precision) {
        precision = precision === undefined ? 0 : (+precision || 0);
        if (precision) {
          precision = pow(10, precision);
          return func(number * precision) / precision;
        }
        return func(number);
      };
    }

    /**
     * Creates a `_.sortedIndex` or `_.sortedLastIndex` function.
     *
     * @private
     * @param {boolean} [retHighest] Specify returning the highest qualified index.
     * @returns {Function} Returns the new index function.
     */
    function createSortedIndex(retHighest) {
      return function(array, value, iteratee, thisArg) {
        var callback = getCallback(iteratee);
        return (iteratee == null && callback === baseCallback)
          ? binaryIndex(array, value, retHighest)
          : binaryIndexBy(array, value, callback(iteratee, thisArg, 1), retHighest);
      };
    }

    /**
     * Creates a function that either curries or invokes `func` with optional
     * `this` binding and partially applied arguments.
     *
     * @private
     * @param {Function|string} func The function or method name to reference.
     * @param {number} bitmask The bitmask of flags.
     *  The bitmask may be composed of the following flags:
     *     1 - `_.bind`
     *     2 - `_.bindKey`
     *     4 - `_.curry` or `_.curryRight` of a bound function
     *     8 - `_.curry`
     *    16 - `_.curryRight`
     *    32 - `_.partial`
     *    64 - `_.partialRight`
     *   128 - `_.rearg`
     *   256 - `_.ary`
     * @param {*} [thisArg] The `this` binding of `func`.
     * @param {Array} [partials] The arguments to be partially applied.
     * @param {Array} [holders] The `partials` placeholder indexes.
     * @param {Array} [argPos] The argument positions of the new function.
     * @param {number} [ary] The arity cap of `func`.
     * @param {number} [arity] The arity of `func`.
     * @returns {Function} Returns the new wrapped function.
     */
    function createWrapper(func, bitmask, thisArg, partials, holders, argPos, ary, arity) {
      var isBindKey = bitmask & BIND_KEY_FLAG;
      if (!isBindKey && typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      var length = partials ? partials.length : 0;
      if (!length) {
        bitmask &= ~(PARTIAL_FLAG | PARTIAL_RIGHT_FLAG);
        partials = holders = undefined;
      }
      length -= (holders ? holders.length : 0);
      if (bitmask & PARTIAL_RIGHT_FLAG) {
        var partialsRight = partials,
            holdersRight = holders;

        partials = holders = undefined;
      }
      var data = isBindKey ? undefined : getData(func),
          newData = [func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary, arity];

      if (data) {
        mergeData(newData, data);
        bitmask = newData[1];
        arity = newData[9];
      }
      newData[9] = arity == null
        ? (isBindKey ? 0 : func.length)
        : (nativeMax(arity - length, 0) || 0);

      if (bitmask == BIND_FLAG) {
        var result = createBindWrapper(newData[0], newData[2]);
      } else if ((bitmask == PARTIAL_FLAG || bitmask == (BIND_FLAG | PARTIAL_FLAG)) && !newData[4].length) {
        result = createPartialWrapper.apply(undefined, newData);
      } else {
        result = createHybridWrapper.apply(undefined, newData);
      }
      var setter = data ? baseSetData : setData;
      return setter(result, newData);
    }

    /**
     * A specialized version of `baseIsEqualDeep` for arrays with support for
     * partial deep comparisons.
     *
     * @private
     * @param {Array} array The array to compare.
     * @param {Array} other The other array to compare.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Function} [customizer] The function to customize comparing arrays.
     * @param {boolean} [isLoose] Specify performing partial comparisons.
     * @param {Array} [stackA] Tracks traversed `value` objects.
     * @param {Array} [stackB] Tracks traversed `other` objects.
     * @returns {boolean} Returns `true` if the arrays are equivalent, else `false`.
     */
    function equalArrays(array, other, equalFunc, customizer, isLoose, stackA, stackB) {
      var index = -1,
          arrLength = array.length,
          othLength = other.length;

      if (arrLength != othLength && !(isLoose && othLength > arrLength)) {
        return false;
      }
      // Ignore non-index properties.
      while (++index < arrLength) {
        var arrValue = array[index],
            othValue = other[index],
            result = customizer ? customizer(isLoose ? othValue : arrValue, isLoose ? arrValue : othValue, index) : undefined;

        if (result !== undefined) {
          if (result) {
            continue;
          }
          return false;
        }
        // Recursively compare arrays (susceptible to call stack limits).
        if (isLoose) {
          if (!arraySome(other, function(othValue) {
                return arrValue === othValue || equalFunc(arrValue, othValue, customizer, isLoose, stackA, stackB);
              })) {
            return false;
          }
        } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, customizer, isLoose, stackA, stackB))) {
          return false;
        }
      }
      return true;
    }

    /**
     * A specialized version of `baseIsEqualDeep` for comparing objects of
     * the same `toStringTag`.
     *
     * **Note:** This function only supports comparing values with tags of
     * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {string} tag The `toStringTag` of the objects to compare.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */
    function equalByTag(object, other, tag) {
      switch (tag) {
        case boolTag:
        case dateTag:
          // Coerce dates and booleans to numbers, dates to milliseconds and booleans
          // to `1` or `0` treating invalid dates coerced to `NaN` as not equal.
          return +object == +other;

        case errorTag:
          return object.name == other.name && object.message == other.message;

        case numberTag:
          // Treat `NaN` vs. `NaN` as equal.
          return (object != +object)
            ? other != +other
            : object == +other;

        case regexpTag:
        case stringTag:
          // Coerce regexes to strings and treat strings primitives and string
          // objects as equal. See https://es5.github.io/#x15.10.6.4 for more details.
          return object == (other + '');
      }
      return false;
    }

    /**
     * A specialized version of `baseIsEqualDeep` for objects with support for
     * partial deep comparisons.
     *
     * @private
     * @param {Object} object The object to compare.
     * @param {Object} other The other object to compare.
     * @param {Function} equalFunc The function to determine equivalents of values.
     * @param {Function} [customizer] The function to customize comparing values.
     * @param {boolean} [isLoose] Specify performing partial comparisons.
     * @param {Array} [stackA] Tracks traversed `value` objects.
     * @param {Array} [stackB] Tracks traversed `other` objects.
     * @returns {boolean} Returns `true` if the objects are equivalent, else `false`.
     */
    function equalObjects(object, other, equalFunc, customizer, isLoose, stackA, stackB) {
      var objProps = keys(object),
          objLength = objProps.length,
          othProps = keys(other),
          othLength = othProps.length;

      if (objLength != othLength && !isLoose) {
        return false;
      }
      var index = objLength;
      while (index--) {
        var key = objProps[index];
        if (!(isLoose ? key in other : hasOwnProperty.call(other, key))) {
          return false;
        }
      }
      var skipCtor = isLoose;
      while (++index < objLength) {
        key = objProps[index];
        var objValue = object[key],
            othValue = other[key],
            result = customizer ? customizer(isLoose ? othValue : objValue, isLoose? objValue : othValue, key) : undefined;

        // Recursively compare objects (susceptible to call stack limits).
        if (!(result === undefined ? equalFunc(objValue, othValue, customizer, isLoose, stackA, stackB) : result)) {
          return false;
        }
        skipCtor || (skipCtor = key == 'constructor');
      }
      if (!skipCtor) {
        var objCtor = object.constructor,
            othCtor = other.constructor;

        // Non `Object` object instances with different constructors are not equal.
        if (objCtor != othCtor &&
            ('constructor' in object && 'constructor' in other) &&
            !(typeof objCtor == 'function' && objCtor instanceof objCtor &&
              typeof othCtor == 'function' && othCtor instanceof othCtor)) {
          return false;
        }
      }
      return true;
    }

    /**
     * Gets the appropriate "callback" function. If the `_.callback` method is
     * customized this function returns the custom method, otherwise it returns
     * the `baseCallback` function. If arguments are provided the chosen function
     * is invoked with them and its result is returned.
     *
     * @private
     * @returns {Function} Returns the chosen function or its result.
     */
    function getCallback(func, thisArg, argCount) {
      var result = lodash.callback || callback;
      result = result === callback ? baseCallback : result;
      return argCount ? result(func, thisArg, argCount) : result;
    }

    /**
     * Gets metadata for `func`.
     *
     * @private
     * @param {Function} func The function to query.
     * @returns {*} Returns the metadata for `func`.
     */
    var getData = !metaMap ? noop : function(func) {
      return metaMap.get(func);
    };

    /**
     * Gets the name of `func`.
     *
     * @private
     * @param {Function} func The function to query.
     * @returns {string} Returns the function name.
     */
    function getFuncName(func) {
      var result = (func.name + ''),
          array = realNames[result],
          length = array ? array.length : 0;

      while (length--) {
        var data = array[length],
            otherFunc = data.func;
        if (otherFunc == null || otherFunc == func) {
          return data.name;
        }
      }
      return result;
    }

    /**
     * Gets the appropriate "indexOf" function. If the `_.indexOf` method is
     * customized this function returns the custom method, otherwise it returns
     * the `baseIndexOf` function. If arguments are provided the chosen function
     * is invoked with them and its result is returned.
     *
     * @private
     * @returns {Function|number} Returns the chosen function or its result.
     */
    function getIndexOf(collection, target, fromIndex) {
      var result = lodash.indexOf || indexOf;
      result = result === indexOf ? baseIndexOf : result;
      return collection ? result(collection, target, fromIndex) : result;
    }

    /**
     * Gets the "length" property value of `object`.
     *
     * **Note:** This function is used to avoid a [JIT bug](https://bugs.webkit.org/show_bug.cgi?id=142792)
     * that affects Safari on at least iOS 8.1-8.3 ARM64.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {*} Returns the "length" value.
     */
    var getLength = baseProperty('length');

    /**
     * Gets the propery names, values, and compare flags of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the match data of `object`.
     */
    function getMatchData(object) {
      var result = pairs(object),
          length = result.length;

      while (length--) {
        result[length][2] = isStrictComparable(result[length][1]);
      }
      return result;
    }

    /**
     * Gets the native function at `key` of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {string} key The key of the method to get.
     * @returns {*} Returns the function if it's native, else `undefined`.
     */
    function getNative(object, key) {
      var value = object == null ? undefined : object[key];
      return isNative(value) ? value : undefined;
    }

    /**
     * Gets the view, applying any `transforms` to the `start` and `end` positions.
     *
     * @private
     * @param {number} start The start of the view.
     * @param {number} end The end of the view.
     * @param {Array} transforms The transformations to apply to the view.
     * @returns {Object} Returns an object containing the `start` and `end`
     *  positions of the view.
     */
    function getView(start, end, transforms) {
      var index = -1,
          length = transforms.length;

      while (++index < length) {
        var data = transforms[index],
            size = data.size;

        switch (data.type) {
          case 'drop':      start += size; break;
          case 'dropRight': end -= size; break;
          case 'take':      end = nativeMin(end, start + size); break;
          case 'takeRight': start = nativeMax(start, end - size); break;
        }
      }
      return { 'start': start, 'end': end };
    }

    /**
     * Initializes an array clone.
     *
     * @private
     * @param {Array} array The array to clone.
     * @returns {Array} Returns the initialized clone.
     */
    function initCloneArray(array) {
      var length = array.length,
          result = new array.constructor(length);

      // Add array properties assigned by `RegExp#exec`.
      if (length && typeof array[0] == 'string' && hasOwnProperty.call(array, 'index')) {
        result.index = array.index;
        result.input = array.input;
      }
      return result;
    }

    /**
     * Initializes an object clone.
     *
     * @private
     * @param {Object} object The object to clone.
     * @returns {Object} Returns the initialized clone.
     */
    function initCloneObject(object) {
      var Ctor = object.constructor;
      if (!(typeof Ctor == 'function' && Ctor instanceof Ctor)) {
        Ctor = Object;
      }
      return new Ctor;
    }

    /**
     * Initializes an object clone based on its `toStringTag`.
     *
     * **Note:** This function only supports cloning values with tags of
     * `Boolean`, `Date`, `Error`, `Number`, `RegExp`, or `String`.
     *
     * @private
     * @param {Object} object The object to clone.
     * @param {string} tag The `toStringTag` of the object to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @returns {Object} Returns the initialized clone.
     */
    function initCloneByTag(object, tag, isDeep) {
      var Ctor = object.constructor;
      switch (tag) {
        case arrayBufferTag:
          return bufferClone(object);

        case boolTag:
        case dateTag:
          return new Ctor(+object);

        case float32Tag: case float64Tag:
        case int8Tag: case int16Tag: case int32Tag:
        case uint8Tag: case uint8ClampedTag: case uint16Tag: case uint32Tag:
          // Safari 5 mobile incorrectly has `Object` as the constructor of typed arrays.
          if (Ctor instanceof Ctor) {
            Ctor = ctorByTag[tag];
          }
          var buffer = object.buffer;
          return new Ctor(isDeep ? bufferClone(buffer) : buffer, object.byteOffset, object.length);

        case numberTag:
        case stringTag:
          return new Ctor(object);

        case regexpTag:
          var result = new Ctor(object.source, reFlags.exec(object));
          result.lastIndex = object.lastIndex;
      }
      return result;
    }

    /**
     * Invokes the method at `path` on `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @param {Array|string} path The path of the method to invoke.
     * @param {Array} args The arguments to invoke the method with.
     * @returns {*} Returns the result of the invoked method.
     */
    function invokePath(object, path, args) {
      if (object != null && !isKey(path, object)) {
        path = toPath(path);
        object = path.length == 1 ? object : baseGet(object, baseSlice(path, 0, -1));
        path = last(path);
      }
      var func = object == null ? object : object[path];
      return func == null ? undefined : func.apply(object, args);
    }

    /**
     * Checks if `value` is array-like.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is array-like, else `false`.
     */
    function isArrayLike(value) {
      return value != null && isLength(getLength(value));
    }

    /**
     * Checks if `value` is a valid array-like index.
     *
     * @private
     * @param {*} value The value to check.
     * @param {number} [length=MAX_SAFE_INTEGER] The upper bounds of a valid index.
     * @returns {boolean} Returns `true` if `value` is a valid index, else `false`.
     */
    function isIndex(value, length) {
      value = (typeof value == 'number' || reIsUint.test(value)) ? +value : -1;
      length = length == null ? MAX_SAFE_INTEGER : length;
      return value > -1 && value % 1 == 0 && value < length;
    }

    /**
     * Checks if the provided arguments are from an iteratee call.
     *
     * @private
     * @param {*} value The potential iteratee value argument.
     * @param {*} index The potential iteratee index or key argument.
     * @param {*} object The potential iteratee object argument.
     * @returns {boolean} Returns `true` if the arguments are from an iteratee call, else `false`.
     */
    function isIterateeCall(value, index, object) {
      if (!isObject(object)) {
        return false;
      }
      var type = typeof index;
      if (type == 'number'
          ? (isArrayLike(object) && isIndex(index, object.length))
          : (type == 'string' && index in object)) {
        var other = object[index];
        return value === value ? (value === other) : (other !== other);
      }
      return false;
    }

    /**
     * Checks if `value` is a property name and not a property path.
     *
     * @private
     * @param {*} value The value to check.
     * @param {Object} [object] The object to query keys on.
     * @returns {boolean} Returns `true` if `value` is a property name, else `false`.
     */
    function isKey(value, object) {
      var type = typeof value;
      if ((type == 'string' && reIsPlainProp.test(value)) || type == 'number') {
        return true;
      }
      if (isArray(value)) {
        return false;
      }
      var result = !reIsDeepProp.test(value);
      return result || (object != null && value in toObject(object));
    }

    /**
     * Checks if `func` has a lazy counterpart.
     *
     * @private
     * @param {Function} func The function to check.
     * @returns {boolean} Returns `true` if `func` has a lazy counterpart, else `false`.
     */
    function isLaziable(func) {
      var funcName = getFuncName(func),
          other = lodash[funcName];

      if (typeof other != 'function' || !(funcName in LazyWrapper.prototype)) {
        return false;
      }
      if (func === other) {
        return true;
      }
      var data = getData(other);
      return !!data && func === data[0];
    }

    /**
     * Checks if `value` is a valid array-like length.
     *
     * **Note:** This function is based on [`ToLength`](http://ecma-international.org/ecma-262/6.0/#sec-tolength).
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a valid length, else `false`.
     */
    function isLength(value) {
      return typeof value == 'number' && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
    }

    /**
     * Checks if `value` is suitable for strict equality comparisons, i.e. `===`.
     *
     * @private
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` if suitable for strict
     *  equality comparisons, else `false`.
     */
    function isStrictComparable(value) {
      return value === value && !isObject(value);
    }

    /**
     * Merges the function metadata of `source` into `data`.
     *
     * Merging metadata reduces the number of wrappers required to invoke a function.
     * This is possible because methods like `_.bind`, `_.curry`, and `_.partial`
     * may be applied regardless of execution order. Methods like `_.ary` and `_.rearg`
     * augment function arguments, making the order in which they are executed important,
     * preventing the merging of metadata. However, we make an exception for a safe
     * common case where curried functions have `_.ary` and or `_.rearg` applied.
     *
     * @private
     * @param {Array} data The destination metadata.
     * @param {Array} source The source metadata.
     * @returns {Array} Returns `data`.
     */
    function mergeData(data, source) {
      var bitmask = data[1],
          srcBitmask = source[1],
          newBitmask = bitmask | srcBitmask,
          isCommon = newBitmask < ARY_FLAG;

      var isCombo =
        (srcBitmask == ARY_FLAG && bitmask == CURRY_FLAG) ||
        (srcBitmask == ARY_FLAG && bitmask == REARG_FLAG && data[7].length <= source[8]) ||
        (srcBitmask == (ARY_FLAG | REARG_FLAG) && bitmask == CURRY_FLAG);

      // Exit early if metadata can't be merged.
      if (!(isCommon || isCombo)) {
        return data;
      }
      // Use source `thisArg` if available.
      if (srcBitmask & BIND_FLAG) {
        data[2] = source[2];
        // Set when currying a bound function.
        newBitmask |= (bitmask & BIND_FLAG) ? 0 : CURRY_BOUND_FLAG;
      }
      // Compose partial arguments.
      var value = source[3];
      if (value) {
        var partials = data[3];
        data[3] = partials ? composeArgs(partials, value, source[4]) : arrayCopy(value);
        data[4] = partials ? replaceHolders(data[3], PLACEHOLDER) : arrayCopy(source[4]);
      }
      // Compose partial right arguments.
      value = source[5];
      if (value) {
        partials = data[5];
        data[5] = partials ? composeArgsRight(partials, value, source[6]) : arrayCopy(value);
        data[6] = partials ? replaceHolders(data[5], PLACEHOLDER) : arrayCopy(source[6]);
      }
      // Use source `argPos` if available.
      value = source[7];
      if (value) {
        data[7] = arrayCopy(value);
      }
      // Use source `ary` if it's smaller.
      if (srcBitmask & ARY_FLAG) {
        data[8] = data[8] == null ? source[8] : nativeMin(data[8], source[8]);
      }
      // Use source `arity` if one is not provided.
      if (data[9] == null) {
        data[9] = source[9];
      }
      // Use source `func` and merge bitmasks.
      data[0] = source[0];
      data[1] = newBitmask;

      return data;
    }

    /**
     * Used by `_.defaultsDeep` to customize its `_.merge` use.
     *
     * @private
     * @param {*} objectValue The destination object property value.
     * @param {*} sourceValue The source object property value.
     * @returns {*} Returns the value to assign to the destination object.
     */
    function mergeDefaults(objectValue, sourceValue) {
      return objectValue === undefined ? sourceValue : merge(objectValue, sourceValue, mergeDefaults);
    }

    /**
     * A specialized version of `_.pick` which picks `object` properties specified
     * by `props`.
     *
     * @private
     * @param {Object} object The source object.
     * @param {string[]} props The property names to pick.
     * @returns {Object} Returns the new object.
     */
    function pickByArray(object, props) {
      object = toObject(object);

      var index = -1,
          length = props.length,
          result = {};

      while (++index < length) {
        var key = props[index];
        if (key in object) {
          result[key] = object[key];
        }
      }
      return result;
    }

    /**
     * A specialized version of `_.pick` which picks `object` properties `predicate`
     * returns truthy for.
     *
     * @private
     * @param {Object} object The source object.
     * @param {Function} predicate The function invoked per iteration.
     * @returns {Object} Returns the new object.
     */
    function pickByCallback(object, predicate) {
      var result = {};
      baseForIn(object, function(value, key, object) {
        if (predicate(value, key, object)) {
          result[key] = value;
        }
      });
      return result;
    }

    /**
     * Reorder `array` according to the specified indexes where the element at
     * the first index is assigned as the first element, the element at
     * the second index is assigned as the second element, and so on.
     *
     * @private
     * @param {Array} array The array to reorder.
     * @param {Array} indexes The arranged array indexes.
     * @returns {Array} Returns `array`.
     */
    function reorder(array, indexes) {
      var arrLength = array.length,
          length = nativeMin(indexes.length, arrLength),
          oldArray = arrayCopy(array);

      while (length--) {
        var index = indexes[length];
        array[length] = isIndex(index, arrLength) ? oldArray[index] : undefined;
      }
      return array;
    }

    /**
     * Sets metadata for `func`.
     *
     * **Note:** If this function becomes hot, i.e. is invoked a lot in a short
     * period of time, it will trip its breaker and transition to an identity function
     * to avoid garbage collection pauses in V8. See [V8 issue 2070](https://code.google.com/p/v8/issues/detail?id=2070)
     * for more details.
     *
     * @private
     * @param {Function} func The function to associate metadata with.
     * @param {*} data The metadata.
     * @returns {Function} Returns `func`.
     */
    var setData = (function() {
      var count = 0,
          lastCalled = 0;

      return function(key, value) {
        var stamp = now(),
            remaining = HOT_SPAN - (stamp - lastCalled);

        lastCalled = stamp;
        if (remaining > 0) {
          if (++count >= HOT_COUNT) {
            return key;
          }
        } else {
          count = 0;
        }
        return baseSetData(key, value);
      };
    }());

    /**
     * A fallback implementation of `Object.keys` which creates an array of the
     * own enumerable property names of `object`.
     *
     * @private
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     */
    function shimKeys(object) {
      var props = keysIn(object),
          propsLength = props.length,
          length = propsLength && object.length;

      var allowIndexes = !!length && isLength(length) &&
        (isArray(object) || isArguments(object) || isString(object));

      var index = -1,
          result = [];

      while (++index < propsLength) {
        var key = props[index];
        if ((allowIndexes && isIndex(key, length)) || hasOwnProperty.call(object, key)) {
          result.push(key);
        }
      }
      return result;
    }

    /**
     * Converts `value` to an array-like object if it's not one.
     *
     * @private
     * @param {*} value The value to process.
     * @returns {Array|Object} Returns the array-like object.
     */
    function toIterable(value) {
      if (value == null) {
        return [];
      }
      if (!isArrayLike(value)) {
        return values(value);
      }
      if (lodash.support.unindexedChars && isString(value)) {
        return value.split('');
      }
      return isObject(value) ? value : Object(value);
    }

    /**
     * Converts `value` to an object if it's not one.
     *
     * @private
     * @param {*} value The value to process.
     * @returns {Object} Returns the object.
     */
    function toObject(value) {
      if (lodash.support.unindexedChars && isString(value)) {
        var index = -1,
            length = value.length,
            result = Object(value);

        while (++index < length) {
          result[index] = value.charAt(index);
        }
        return result;
      }
      return isObject(value) ? value : Object(value);
    }

    /**
     * Converts `value` to property path array if it's not one.
     *
     * @private
     * @param {*} value The value to process.
     * @returns {Array} Returns the property path array.
     */
    function toPath(value) {
      if (isArray(value)) {
        return value;
      }
      var result = [];
      baseToString(value).replace(rePropName, function(match, number, quote, string) {
        result.push(quote ? string.replace(reEscapeChar, '$1') : (number || match));
      });
      return result;
    }

    /**
     * Creates a clone of `wrapper`.
     *
     * @private
     * @param {Object} wrapper The wrapper to clone.
     * @returns {Object} Returns the cloned wrapper.
     */
    function wrapperClone(wrapper) {
      return wrapper instanceof LazyWrapper
        ? wrapper.clone()
        : new LodashWrapper(wrapper.__wrapped__, wrapper.__chain__, arrayCopy(wrapper.__actions__));
    }

    /*------------------------------------------------------------------------*/

    /**
     * Creates an array of elements split into groups the length of `size`.
     * If `collection` can't be split evenly, the final chunk will be the remaining
     * elements.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to process.
     * @param {number} [size=1] The length of each chunk.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the new array containing chunks.
     * @example
     *
     * _.chunk(['a', 'b', 'c', 'd'], 2);
     * // => [['a', 'b'], ['c', 'd']]
     *
     * _.chunk(['a', 'b', 'c', 'd'], 3);
     * // => [['a', 'b', 'c'], ['d']]
     */
    function chunk(array, size, guard) {
      if (guard ? isIterateeCall(array, size, guard) : size == null) {
        size = 1;
      } else {
        size = nativeMax(nativeFloor(size) || 1, 1);
      }
      var index = 0,
          length = array ? array.length : 0,
          resIndex = -1,
          result = Array(nativeCeil(length / size));

      while (index < length) {
        result[++resIndex] = baseSlice(array, index, (index += size));
      }
      return result;
    }

    /**
     * Creates an array with all falsey values removed. The values `false`, `null`,
     * `0`, `""`, `undefined`, and `NaN` are falsey.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to compact.
     * @returns {Array} Returns the new array of filtered values.
     * @example
     *
     * _.compact([0, 1, false, 2, '', 3]);
     * // => [1, 2, 3]
     */
    function compact(array) {
      var index = -1,
          length = array ? array.length : 0,
          resIndex = -1,
          result = [];

      while (++index < length) {
        var value = array[index];
        if (value) {
          result[++resIndex] = value;
        }
      }
      return result;
    }

    /**
     * Creates an array of unique `array` values not included in the other
     * provided arrays using [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to inspect.
     * @param {...Array} [values] The arrays of values to exclude.
     * @returns {Array} Returns the new array of filtered values.
     * @example
     *
     * _.difference([1, 2, 3], [4, 2]);
     * // => [1, 3]
     */
    var difference = restParam(function(array, values) {
      return (isObjectLike(array) && isArrayLike(array))
        ? baseDifference(array, baseFlatten(values, false, true))
        : [];
    });

    /**
     * Creates a slice of `array` with `n` elements dropped from the beginning.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {number} [n=1] The number of elements to drop.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.drop([1, 2, 3]);
     * // => [2, 3]
     *
     * _.drop([1, 2, 3], 2);
     * // => [3]
     *
     * _.drop([1, 2, 3], 5);
     * // => []
     *
     * _.drop([1, 2, 3], 0);
     * // => [1, 2, 3]
     */
    function drop(array, n, guard) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (guard ? isIterateeCall(array, n, guard) : n == null) {
        n = 1;
      }
      return baseSlice(array, n < 0 ? 0 : n);
    }

    /**
     * Creates a slice of `array` with `n` elements dropped from the end.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {number} [n=1] The number of elements to drop.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.dropRight([1, 2, 3]);
     * // => [1, 2]
     *
     * _.dropRight([1, 2, 3], 2);
     * // => [1]
     *
     * _.dropRight([1, 2, 3], 5);
     * // => []
     *
     * _.dropRight([1, 2, 3], 0);
     * // => [1, 2, 3]
     */
    function dropRight(array, n, guard) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (guard ? isIterateeCall(array, n, guard) : n == null) {
        n = 1;
      }
      n = length - (+n || 0);
      return baseSlice(array, 0, n < 0 ? 0 : n);
    }

    /**
     * Creates a slice of `array` excluding elements dropped from the end.
     * Elements are dropped until `predicate` returns falsey. The predicate is
     * bound to `thisArg` and invoked with three arguments: (value, index, array).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that match the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.dropRightWhile([1, 2, 3], function(n) {
     *   return n > 1;
     * });
     * // => [1]
     *
     * var users = [
     *   { 'user': 'barney',  'active': true },
     *   { 'user': 'fred',    'active': false },
     *   { 'user': 'pebbles', 'active': false }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.dropRightWhile(users, { 'user': 'pebbles', 'active': false }), 'user');
     * // => ['barney', 'fred']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.dropRightWhile(users, 'active', false), 'user');
     * // => ['barney']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.dropRightWhile(users, 'active'), 'user');
     * // => ['barney', 'fred', 'pebbles']
     */
    function dropRightWhile(array, predicate, thisArg) {
      return (array && array.length)
        ? baseWhile(array, getCallback(predicate, thisArg, 3), true, true)
        : [];
    }

    /**
     * Creates a slice of `array` excluding elements dropped from the beginning.
     * Elements are dropped until `predicate` returns falsey. The predicate is
     * bound to `thisArg` and invoked with three arguments: (value, index, array).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.dropWhile([1, 2, 3], function(n) {
     *   return n < 3;
     * });
     * // => [3]
     *
     * var users = [
     *   { 'user': 'barney',  'active': false },
     *   { 'user': 'fred',    'active': false },
     *   { 'user': 'pebbles', 'active': true }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.dropWhile(users, { 'user': 'barney', 'active': false }), 'user');
     * // => ['fred', 'pebbles']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.dropWhile(users, 'active', false), 'user');
     * // => ['pebbles']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.dropWhile(users, 'active'), 'user');
     * // => ['barney', 'fred', 'pebbles']
     */
    function dropWhile(array, predicate, thisArg) {
      return (array && array.length)
        ? baseWhile(array, getCallback(predicate, thisArg, 3), true)
        : [];
    }

    /**
     * Fills elements of `array` with `value` from `start` up to, but not
     * including, `end`.
     *
     * **Note:** This method mutates `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to fill.
     * @param {*} value The value to fill `array` with.
     * @param {number} [start=0] The start position.
     * @param {number} [end=array.length] The end position.
     * @returns {Array} Returns `array`.
     * @example
     *
     * var array = [1, 2, 3];
     *
     * _.fill(array, 'a');
     * console.log(array);
     * // => ['a', 'a', 'a']
     *
     * _.fill(Array(3), 2);
     * // => [2, 2, 2]
     *
     * _.fill([4, 6, 8], '*', 1, 2);
     * // => [4, '*', 8]
     */
    function fill(array, value, start, end) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (start && typeof start != 'number' && isIterateeCall(array, value, start)) {
        start = 0;
        end = length;
      }
      return baseFill(array, value, start, end);
    }

    /**
     * This method is like `_.find` except that it returns the index of the first
     * element `predicate` returns truthy for instead of the element itself.
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {number} Returns the index of the found element, else `-1`.
     * @example
     *
     * var users = [
     *   { 'user': 'barney',  'active': false },
     *   { 'user': 'fred',    'active': false },
     *   { 'user': 'pebbles', 'active': true }
     * ];
     *
     * _.findIndex(users, function(chr) {
     *   return chr.user == 'barney';
     * });
     * // => 0
     *
     * // using the `_.matches` callback shorthand
     * _.findIndex(users, { 'user': 'fred', 'active': false });
     * // => 1
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.findIndex(users, 'active', false);
     * // => 0
     *
     * // using the `_.property` callback shorthand
     * _.findIndex(users, 'active');
     * // => 2
     */
    var findIndex = createFindIndex();

    /**
     * This method is like `_.findIndex` except that it iterates over elements
     * of `collection` from right to left.
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {number} Returns the index of the found element, else `-1`.
     * @example
     *
     * var users = [
     *   { 'user': 'barney',  'active': true },
     *   { 'user': 'fred',    'active': false },
     *   { 'user': 'pebbles', 'active': false }
     * ];
     *
     * _.findLastIndex(users, function(chr) {
     *   return chr.user == 'pebbles';
     * });
     * // => 2
     *
     * // using the `_.matches` callback shorthand
     * _.findLastIndex(users, { 'user': 'barney', 'active': true });
     * // => 0
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.findLastIndex(users, 'active', false);
     * // => 2
     *
     * // using the `_.property` callback shorthand
     * _.findLastIndex(users, 'active');
     * // => 0
     */
    var findLastIndex = createFindIndex(true);

    /**
     * Gets the first element of `array`.
     *
     * @static
     * @memberOf _
     * @alias head
     * @category Array
     * @param {Array} array The array to query.
     * @returns {*} Returns the first element of `array`.
     * @example
     *
     * _.first([1, 2, 3]);
     * // => 1
     *
     * _.first([]);
     * // => undefined
     */
    function first(array) {
      return array ? array[0] : undefined;
    }

    /**
     * Flattens a nested array. If `isDeep` is `true` the array is recursively
     * flattened, otherwise it's only flattened a single level.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to flatten.
     * @param {boolean} [isDeep] Specify a deep flatten.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the new flattened array.
     * @example
     *
     * _.flatten([1, [2, 3, [4]]]);
     * // => [1, 2, 3, [4]]
     *
     * // using `isDeep`
     * _.flatten([1, [2, 3, [4]]], true);
     * // => [1, 2, 3, 4]
     */
    function flatten(array, isDeep, guard) {
      var length = array ? array.length : 0;
      if (guard && isIterateeCall(array, isDeep, guard)) {
        isDeep = false;
      }
      return length ? baseFlatten(array, isDeep) : [];
    }

    /**
     * Recursively flattens a nested array.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to recursively flatten.
     * @returns {Array} Returns the new flattened array.
     * @example
     *
     * _.flattenDeep([1, [2, 3, [4]]]);
     * // => [1, 2, 3, 4]
     */
    function flattenDeep(array) {
      var length = array ? array.length : 0;
      return length ? baseFlatten(array, true) : [];
    }

    /**
     * Gets the index at which the first occurrence of `value` is found in `array`
     * using [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons. If `fromIndex` is negative, it's used as the offset
     * from the end of `array`. If `array` is sorted providing `true` for `fromIndex`
     * performs a faster binary search.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to search.
     * @param {*} value The value to search for.
     * @param {boolean|number} [fromIndex=0] The index to search from or `true`
     *  to perform a binary search on a sorted array.
     * @returns {number} Returns the index of the matched value, else `-1`.
     * @example
     *
     * _.indexOf([1, 2, 1, 2], 2);
     * // => 1
     *
     * // using `fromIndex`
     * _.indexOf([1, 2, 1, 2], 2, 2);
     * // => 3
     *
     * // performing a binary search
     * _.indexOf([1, 1, 2, 2], 2, true);
     * // => 2
     */
    function indexOf(array, value, fromIndex) {
      var length = array ? array.length : 0;
      if (!length) {
        return -1;
      }
      if (typeof fromIndex == 'number') {
        fromIndex = fromIndex < 0 ? nativeMax(length + fromIndex, 0) : fromIndex;
      } else if (fromIndex) {
        var index = binaryIndex(array, value);
        if (index < length &&
            (value === value ? (value === array[index]) : (array[index] !== array[index]))) {
          return index;
        }
        return -1;
      }
      return baseIndexOf(array, value, fromIndex || 0);
    }

    /**
     * Gets all but the last element of `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.initial([1, 2, 3]);
     * // => [1, 2]
     */
    function initial(array) {
      return dropRight(array, 1);
    }

    /**
     * Creates an array of unique values that are included in all of the provided
     * arrays using [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {...Array} [arrays] The arrays to inspect.
     * @returns {Array} Returns the new array of shared values.
     * @example
     * _.intersection([1, 2], [4, 2], [2, 1]);
     * // => [2]
     */
    var intersection = restParam(function(arrays) {
      var othLength = arrays.length,
          othIndex = othLength,
          caches = Array(length),
          indexOf = getIndexOf(),
          isCommon = indexOf === baseIndexOf,
          result = [];

      while (othIndex--) {
        var value = arrays[othIndex] = isArrayLike(value = arrays[othIndex]) ? value : [];
        caches[othIndex] = (isCommon && value.length >= 120) ? createCache(othIndex && value) : null;
      }
      var array = arrays[0],
          index = -1,
          length = array ? array.length : 0,
          seen = caches[0];

      outer:
      while (++index < length) {
        value = array[index];
        if ((seen ? cacheIndexOf(seen, value) : indexOf(result, value, 0)) < 0) {
          var othIndex = othLength;
          while (--othIndex) {
            var cache = caches[othIndex];
            if ((cache ? cacheIndexOf(cache, value) : indexOf(arrays[othIndex], value, 0)) < 0) {
              continue outer;
            }
          }
          if (seen) {
            seen.push(value);
          }
          result.push(value);
        }
      }
      return result;
    });

    /**
     * Gets the last element of `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @returns {*} Returns the last element of `array`.
     * @example
     *
     * _.last([1, 2, 3]);
     * // => 3
     */
    function last(array) {
      var length = array ? array.length : 0;
      return length ? array[length - 1] : undefined;
    }

    /**
     * This method is like `_.indexOf` except that it iterates over elements of
     * `array` from right to left.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to search.
     * @param {*} value The value to search for.
     * @param {boolean|number} [fromIndex=array.length-1] The index to search from
     *  or `true` to perform a binary search on a sorted array.
     * @returns {number} Returns the index of the matched value, else `-1`.
     * @example
     *
     * _.lastIndexOf([1, 2, 1, 2], 2);
     * // => 3
     *
     * // using `fromIndex`
     * _.lastIndexOf([1, 2, 1, 2], 2, 2);
     * // => 1
     *
     * // performing a binary search
     * _.lastIndexOf([1, 1, 2, 2], 2, true);
     * // => 3
     */
    function lastIndexOf(array, value, fromIndex) {
      var length = array ? array.length : 0;
      if (!length) {
        return -1;
      }
      var index = length;
      if (typeof fromIndex == 'number') {
        index = (fromIndex < 0 ? nativeMax(length + fromIndex, 0) : nativeMin(fromIndex || 0, length - 1)) + 1;
      } else if (fromIndex) {
        index = binaryIndex(array, value, true) - 1;
        var other = array[index];
        if (value === value ? (value === other) : (other !== other)) {
          return index;
        }
        return -1;
      }
      if (value !== value) {
        return indexOfNaN(array, index, true);
      }
      while (index--) {
        if (array[index] === value) {
          return index;
        }
      }
      return -1;
    }

    /**
     * Removes all provided values from `array` using
     * [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * **Note:** Unlike `_.without`, this method mutates `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to modify.
     * @param {...*} [values] The values to remove.
     * @returns {Array} Returns `array`.
     * @example
     *
     * var array = [1, 2, 3, 1, 2, 3];
     *
     * _.pull(array, 2, 3);
     * console.log(array);
     * // => [1, 1]
     */
    function pull() {
      var args = arguments,
          array = args[0];

      if (!(array && array.length)) {
        return array;
      }
      var index = 0,
          indexOf = getIndexOf(),
          length = args.length;

      while (++index < length) {
        var fromIndex = 0,
            value = args[index];

        while ((fromIndex = indexOf(array, value, fromIndex)) > -1) {
          splice.call(array, fromIndex, 1);
        }
      }
      return array;
    }

    /**
     * Removes elements from `array` corresponding to the given indexes and returns
     * an array of the removed elements. Indexes may be specified as an array of
     * indexes or as individual arguments.
     *
     * **Note:** Unlike `_.at`, this method mutates `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to modify.
     * @param {...(number|number[])} [indexes] The indexes of elements to remove,
     *  specified as individual indexes or arrays of indexes.
     * @returns {Array} Returns the new array of removed elements.
     * @example
     *
     * var array = [5, 10, 15, 20];
     * var evens = _.pullAt(array, 1, 3);
     *
     * console.log(array);
     * // => [5, 15]
     *
     * console.log(evens);
     * // => [10, 20]
     */
    var pullAt = restParam(function(array, indexes) {
      indexes = baseFlatten(indexes);

      var result = baseAt(array, indexes);
      basePullAt(array, indexes.sort(baseCompareAscending));
      return result;
    });

    /**
     * Removes all elements from `array` that `predicate` returns truthy for
     * and returns an array of the removed elements. The predicate is bound to
     * `thisArg` and invoked with three arguments: (value, index, array).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * **Note:** Unlike `_.filter`, this method mutates `array`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to modify.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the new array of removed elements.
     * @example
     *
     * var array = [1, 2, 3, 4];
     * var evens = _.remove(array, function(n) {
     *   return n % 2 == 0;
     * });
     *
     * console.log(array);
     * // => [1, 3]
     *
     * console.log(evens);
     * // => [2, 4]
     */
    function remove(array, predicate, thisArg) {
      var result = [];
      if (!(array && array.length)) {
        return result;
      }
      var index = -1,
          indexes = [],
          length = array.length;

      predicate = getCallback(predicate, thisArg, 3);
      while (++index < length) {
        var value = array[index];
        if (predicate(value, index, array)) {
          result.push(value);
          indexes.push(index);
        }
      }
      basePullAt(array, indexes);
      return result;
    }

    /**
     * Gets all but the first element of `array`.
     *
     * @static
     * @memberOf _
     * @alias tail
     * @category Array
     * @param {Array} array The array to query.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.rest([1, 2, 3]);
     * // => [2, 3]
     */
    function rest(array) {
      return drop(array, 1);
    }

    /**
     * Creates a slice of `array` from `start` up to, but not including, `end`.
     *
     * **Note:** This method is used instead of `Array#slice` to support node
     * lists in IE < 9 and to ensure dense arrays are returned.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to slice.
     * @param {number} [start=0] The start position.
     * @param {number} [end=array.length] The end position.
     * @returns {Array} Returns the slice of `array`.
     */
    function slice(array, start, end) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (end && typeof end != 'number' && isIterateeCall(array, start, end)) {
        start = 0;
        end = length;
      }
      return baseSlice(array, start, end);
    }

    /**
     * Uses a binary search to determine the lowest index at which `value` should
     * be inserted into `array` in order to maintain its sort order. If an iteratee
     * function is provided it's invoked for `value` and each element of `array`
     * to compute their sort ranking. The iteratee is bound to `thisArg` and
     * invoked with one argument; (value).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The sorted array to inspect.
     * @param {*} value The value to evaluate.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {number} Returns the index at which `value` should be inserted
     *  into `array`.
     * @example
     *
     * _.sortedIndex([30, 50], 40);
     * // => 1
     *
     * _.sortedIndex([4, 4, 5, 5], 5);
     * // => 2
     *
     * var dict = { 'data': { 'thirty': 30, 'forty': 40, 'fifty': 50 } };
     *
     * // using an iteratee function
     * _.sortedIndex(['thirty', 'fifty'], 'forty', function(word) {
     *   return this.data[word];
     * }, dict);
     * // => 1
     *
     * // using the `_.property` callback shorthand
     * _.sortedIndex([{ 'x': 30 }, { 'x': 50 }], { 'x': 40 }, 'x');
     * // => 1
     */
    var sortedIndex = createSortedIndex();

    /**
     * This method is like `_.sortedIndex` except that it returns the highest
     * index at which `value` should be inserted into `array` in order to
     * maintain its sort order.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The sorted array to inspect.
     * @param {*} value The value to evaluate.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {number} Returns the index at which `value` should be inserted
     *  into `array`.
     * @example
     *
     * _.sortedLastIndex([4, 4, 5, 5], 5);
     * // => 4
     */
    var sortedLastIndex = createSortedIndex(true);

    /**
     * Creates a slice of `array` with `n` elements taken from the beginning.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {number} [n=1] The number of elements to take.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.take([1, 2, 3]);
     * // => [1]
     *
     * _.take([1, 2, 3], 2);
     * // => [1, 2]
     *
     * _.take([1, 2, 3], 5);
     * // => [1, 2, 3]
     *
     * _.take([1, 2, 3], 0);
     * // => []
     */
    function take(array, n, guard) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (guard ? isIterateeCall(array, n, guard) : n == null) {
        n = 1;
      }
      return baseSlice(array, 0, n < 0 ? 0 : n);
    }

    /**
     * Creates a slice of `array` with `n` elements taken from the end.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {number} [n=1] The number of elements to take.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.takeRight([1, 2, 3]);
     * // => [3]
     *
     * _.takeRight([1, 2, 3], 2);
     * // => [2, 3]
     *
     * _.takeRight([1, 2, 3], 5);
     * // => [1, 2, 3]
     *
     * _.takeRight([1, 2, 3], 0);
     * // => []
     */
    function takeRight(array, n, guard) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (guard ? isIterateeCall(array, n, guard) : n == null) {
        n = 1;
      }
      n = length - (+n || 0);
      return baseSlice(array, n < 0 ? 0 : n);
    }

    /**
     * Creates a slice of `array` with elements taken from the end. Elements are
     * taken until `predicate` returns falsey. The predicate is bound to `thisArg`
     * and invoked with three arguments: (value, index, array).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.takeRightWhile([1, 2, 3], function(n) {
     *   return n > 1;
     * });
     * // => [2, 3]
     *
     * var users = [
     *   { 'user': 'barney',  'active': true },
     *   { 'user': 'fred',    'active': false },
     *   { 'user': 'pebbles', 'active': false }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.takeRightWhile(users, { 'user': 'pebbles', 'active': false }), 'user');
     * // => ['pebbles']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.takeRightWhile(users, 'active', false), 'user');
     * // => ['fred', 'pebbles']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.takeRightWhile(users, 'active'), 'user');
     * // => []
     */
    function takeRightWhile(array, predicate, thisArg) {
      return (array && array.length)
        ? baseWhile(array, getCallback(predicate, thisArg, 3), false, true)
        : [];
    }

    /**
     * Creates a slice of `array` with elements taken from the beginning. Elements
     * are taken until `predicate` returns falsey. The predicate is bound to
     * `thisArg` and invoked with three arguments: (value, index, array).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to query.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the slice of `array`.
     * @example
     *
     * _.takeWhile([1, 2, 3], function(n) {
     *   return n < 3;
     * });
     * // => [1, 2]
     *
     * var users = [
     *   { 'user': 'barney',  'active': false },
     *   { 'user': 'fred',    'active': false},
     *   { 'user': 'pebbles', 'active': true }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.takeWhile(users, { 'user': 'barney', 'active': false }), 'user');
     * // => ['barney']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.takeWhile(users, 'active', false), 'user');
     * // => ['barney', 'fred']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.takeWhile(users, 'active'), 'user');
     * // => []
     */
    function takeWhile(array, predicate, thisArg) {
      return (array && array.length)
        ? baseWhile(array, getCallback(predicate, thisArg, 3))
        : [];
    }

    /**
     * Creates an array of unique values, in order, from all of the provided arrays
     * using [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {...Array} [arrays] The arrays to inspect.
     * @returns {Array} Returns the new array of combined values.
     * @example
     *
     * _.union([1, 2], [4, 2], [2, 1]);
     * // => [1, 2, 4]
     */
    var union = restParam(function(arrays) {
      return baseUniq(baseFlatten(arrays, false, true));
    });

    /**
     * Creates a duplicate-free version of an array, using
     * [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons, in which only the first occurence of each element
     * is kept. Providing `true` for `isSorted` performs a faster search algorithm
     * for sorted arrays. If an iteratee function is provided it's invoked for
     * each element in the array to generate the criterion by which uniqueness
     * is computed. The `iteratee` is bound to `thisArg` and invoked with three
     * arguments: (value, index, array).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @alias unique
     * @category Array
     * @param {Array} array The array to inspect.
     * @param {boolean} [isSorted] Specify the array is sorted.
     * @param {Function|Object|string} [iteratee] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the new duplicate-value-free array.
     * @example
     *
     * _.uniq([2, 1, 2]);
     * // => [2, 1]
     *
     * // using `isSorted`
     * _.uniq([1, 1, 2], true);
     * // => [1, 2]
     *
     * // using an iteratee function
     * _.uniq([1, 2.5, 1.5, 2], function(n) {
     *   return this.floor(n);
     * }, Math);
     * // => [1, 2.5]
     *
     * // using the `_.property` callback shorthand
     * _.uniq([{ 'x': 1 }, { 'x': 2 }, { 'x': 1 }], 'x');
     * // => [{ 'x': 1 }, { 'x': 2 }]
     */
    function uniq(array, isSorted, iteratee, thisArg) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      if (isSorted != null && typeof isSorted != 'boolean') {
        thisArg = iteratee;
        iteratee = isIterateeCall(array, isSorted, thisArg) ? undefined : isSorted;
        isSorted = false;
      }
      var callback = getCallback();
      if (!(iteratee == null && callback === baseCallback)) {
        iteratee = callback(iteratee, thisArg, 3);
      }
      return (isSorted && getIndexOf() === baseIndexOf)
        ? sortedUniq(array, iteratee)
        : baseUniq(array, iteratee);
    }

    /**
     * This method is like `_.zip` except that it accepts an array of grouped
     * elements and creates an array regrouping the elements to their pre-zip
     * configuration.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array of grouped elements to process.
     * @returns {Array} Returns the new array of regrouped elements.
     * @example
     *
     * var zipped = _.zip(['fred', 'barney'], [30, 40], [true, false]);
     * // => [['fred', 30, true], ['barney', 40, false]]
     *
     * _.unzip(zipped);
     * // => [['fred', 'barney'], [30, 40], [true, false]]
     */
    function unzip(array) {
      if (!(array && array.length)) {
        return [];
      }
      var index = -1,
          length = 0;

      array = arrayFilter(array, function(group) {
        if (isArrayLike(group)) {
          length = nativeMax(group.length, length);
          return true;
        }
      });
      var result = Array(length);
      while (++index < length) {
        result[index] = arrayMap(array, baseProperty(index));
      }
      return result;
    }

    /**
     * This method is like `_.unzip` except that it accepts an iteratee to specify
     * how regrouped values should be combined. The `iteratee` is bound to `thisArg`
     * and invoked with four arguments: (accumulator, value, index, group).
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array of grouped elements to process.
     * @param {Function} [iteratee] The function to combine regrouped values.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the new array of regrouped elements.
     * @example
     *
     * var zipped = _.zip([1, 2], [10, 20], [100, 200]);
     * // => [[1, 10, 100], [2, 20, 200]]
     *
     * _.unzipWith(zipped, _.add);
     * // => [3, 30, 300]
     */
    function unzipWith(array, iteratee, thisArg) {
      var length = array ? array.length : 0;
      if (!length) {
        return [];
      }
      var result = unzip(array);
      if (iteratee == null) {
        return result;
      }
      iteratee = bindCallback(iteratee, thisArg, 4);
      return arrayMap(result, function(group) {
        return arrayReduce(group, iteratee, undefined, true);
      });
    }

    /**
     * Creates an array excluding all provided values using
     * [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {Array} array The array to filter.
     * @param {...*} [values] The values to exclude.
     * @returns {Array} Returns the new array of filtered values.
     * @example
     *
     * _.without([1, 2, 1, 3], 1, 2);
     * // => [3]
     */
    var without = restParam(function(array, values) {
      return isArrayLike(array)
        ? baseDifference(array, values)
        : [];
    });

    /**
     * Creates an array of unique values that is the [symmetric difference](https://en.wikipedia.org/wiki/Symmetric_difference)
     * of the provided arrays.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {...Array} [arrays] The arrays to inspect.
     * @returns {Array} Returns the new array of values.
     * @example
     *
     * _.xor([1, 2], [4, 2]);
     * // => [1, 4]
     */
    function xor() {
      var index = -1,
          length = arguments.length;

      while (++index < length) {
        var array = arguments[index];
        if (isArrayLike(array)) {
          var result = result
            ? arrayPush(baseDifference(result, array), baseDifference(array, result))
            : array;
        }
      }
      return result ? baseUniq(result) : [];
    }

    /**
     * Creates an array of grouped elements, the first of which contains the first
     * elements of the given arrays, the second of which contains the second elements
     * of the given arrays, and so on.
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {...Array} [arrays] The arrays to process.
     * @returns {Array} Returns the new array of grouped elements.
     * @example
     *
     * _.zip(['fred', 'barney'], [30, 40], [true, false]);
     * // => [['fred', 30, true], ['barney', 40, false]]
     */
    var zip = restParam(unzip);

    /**
     * The inverse of `_.pairs`; this method returns an object composed from arrays
     * of property names and values. Provide either a single two dimensional array,
     * e.g. `[[key1, value1], [key2, value2]]` or two arrays, one of property names
     * and one of corresponding values.
     *
     * @static
     * @memberOf _
     * @alias object
     * @category Array
     * @param {Array} props The property names.
     * @param {Array} [values=[]] The property values.
     * @returns {Object} Returns the new object.
     * @example
     *
     * _.zipObject([['fred', 30], ['barney', 40]]);
     * // => { 'fred': 30, 'barney': 40 }
     *
     * _.zipObject(['fred', 'barney'], [30, 40]);
     * // => { 'fred': 30, 'barney': 40 }
     */
    function zipObject(props, values) {
      var index = -1,
          length = props ? props.length : 0,
          result = {};

      if (length && !values && !isArray(props[0])) {
        values = [];
      }
      while (++index < length) {
        var key = props[index];
        if (values) {
          result[key] = values[index];
        } else if (key) {
          result[key[0]] = key[1];
        }
      }
      return result;
    }

    /**
     * This method is like `_.zip` except that it accepts an iteratee to specify
     * how grouped values should be combined. The `iteratee` is bound to `thisArg`
     * and invoked with four arguments: (accumulator, value, index, group).
     *
     * @static
     * @memberOf _
     * @category Array
     * @param {...Array} [arrays] The arrays to process.
     * @param {Function} [iteratee] The function to combine grouped values.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the new array of grouped elements.
     * @example
     *
     * _.zipWith([1, 2], [10, 20], [100, 200], _.add);
     * // => [111, 222]
     */
    var zipWith = restParam(function(arrays) {
      var length = arrays.length,
          iteratee = length > 2 ? arrays[length - 2] : undefined,
          thisArg = length > 1 ? arrays[length - 1] : undefined;

      if (length > 2 && typeof iteratee == 'function') {
        length -= 2;
      } else {
        iteratee = (length > 1 && typeof thisArg == 'function') ? (--length, thisArg) : undefined;
        thisArg = undefined;
      }
      arrays.length = length;
      return unzipWith(arrays, iteratee, thisArg);
    });

    /*------------------------------------------------------------------------*/

    /**
     * Creates a `lodash` object that wraps `value` with explicit method
     * chaining enabled.
     *
     * @static
     * @memberOf _
     * @category Chain
     * @param {*} value The value to wrap.
     * @returns {Object} Returns the new `lodash` wrapper instance.
     * @example
     *
     * var users = [
     *   { 'user': 'barney',  'age': 36 },
     *   { 'user': 'fred',    'age': 40 },
     *   { 'user': 'pebbles', 'age': 1 }
     * ];
     *
     * var youngest = _.chain(users)
     *   .sortBy('age')
     *   .map(function(chr) {
     *     return chr.user + ' is ' + chr.age;
     *   })
     *   .first()
     *   .value();
     * // => 'pebbles is 1'
     */
    function chain(value) {
      var result = lodash(value);
      result.__chain__ = true;
      return result;
    }

    /**
     * This method invokes `interceptor` and returns `value`. The interceptor is
     * bound to `thisArg` and invoked with one argument; (value). The purpose of
     * this method is to "tap into" a method chain in order to perform operations
     * on intermediate results within the chain.
     *
     * @static
     * @memberOf _
     * @category Chain
     * @param {*} value The value to provide to `interceptor`.
     * @param {Function} interceptor The function to invoke.
     * @param {*} [thisArg] The `this` binding of `interceptor`.
     * @returns {*} Returns `value`.
     * @example
     *
     * _([1, 2, 3])
     *  .tap(function(array) {
     *    array.pop();
     *  })
     *  .reverse()
     *  .value();
     * // => [2, 1]
     */
    function tap(value, interceptor, thisArg) {
      interceptor.call(thisArg, value);
      return value;
    }

    /**
     * This method is like `_.tap` except that it returns the result of `interceptor`.
     *
     * @static
     * @memberOf _
     * @category Chain
     * @param {*} value The value to provide to `interceptor`.
     * @param {Function} interceptor The function to invoke.
     * @param {*} [thisArg] The `this` binding of `interceptor`.
     * @returns {*} Returns the result of `interceptor`.
     * @example
     *
     * _('  abc  ')
     *  .chain()
     *  .trim()
     *  .thru(function(value) {
     *    return [value];
     *  })
     *  .value();
     * // => ['abc']
     */
    function thru(value, interceptor, thisArg) {
      return interceptor.call(thisArg, value);
    }

    /**
     * Enables explicit method chaining on the wrapper object.
     *
     * @name chain
     * @memberOf _
     * @category Chain
     * @returns {Object} Returns the new `lodash` wrapper instance.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 40 }
     * ];
     *
     * // without explicit chaining
     * _(users).first();
     * // => { 'user': 'barney', 'age': 36 }
     *
     * // with explicit chaining
     * _(users).chain()
     *   .first()
     *   .pick('user')
     *   .value();
     * // => { 'user': 'barney' }
     */
    function wrapperChain() {
      return chain(this);
    }

    /**
     * Executes the chained sequence and returns the wrapped result.
     *
     * @name commit
     * @memberOf _
     * @category Chain
     * @returns {Object} Returns the new `lodash` wrapper instance.
     * @example
     *
     * var array = [1, 2];
     * var wrapped = _(array).push(3);
     *
     * console.log(array);
     * // => [1, 2]
     *
     * wrapped = wrapped.commit();
     * console.log(array);
     * // => [1, 2, 3]
     *
     * wrapped.last();
     * // => 3
     *
     * console.log(array);
     * // => [1, 2, 3]
     */
    function wrapperCommit() {
      return new LodashWrapper(this.value(), this.__chain__);
    }

    /**
     * Creates a new array joining a wrapped array with any additional arrays
     * and/or values.
     *
     * @name concat
     * @memberOf _
     * @category Chain
     * @param {...*} [values] The values to concatenate.
     * @returns {Array} Returns the new concatenated array.
     * @example
     *
     * var array = [1];
     * var wrapped = _(array).concat(2, [3], [[4]]);
     *
     * console.log(wrapped.value());
     * // => [1, 2, 3, [4]]
     *
     * console.log(array);
     * // => [1]
     */
    var wrapperConcat = restParam(function(values) {
      values = baseFlatten(values);
      return this.thru(function(array) {
        return arrayConcat(isArray(array) ? array : [toObject(array)], values);
      });
    });

    /**
     * Creates a clone of the chained sequence planting `value` as the wrapped value.
     *
     * @name plant
     * @memberOf _
     * @category Chain
     * @returns {Object} Returns the new `lodash` wrapper instance.
     * @example
     *
     * var array = [1, 2];
     * var wrapped = _(array).map(function(value) {
     *   return Math.pow(value, 2);
     * });
     *
     * var other = [3, 4];
     * var otherWrapped = wrapped.plant(other);
     *
     * otherWrapped.value();
     * // => [9, 16]
     *
     * wrapped.value();
     * // => [1, 4]
     */
    function wrapperPlant(value) {
      var result,
          parent = this;

      while (parent instanceof baseLodash) {
        var clone = wrapperClone(parent);
        if (result) {
          previous.__wrapped__ = clone;
        } else {
          result = clone;
        }
        var previous = clone;
        parent = parent.__wrapped__;
      }
      previous.__wrapped__ = value;
      return result;
    }

    /**
     * Reverses the wrapped array so the first element becomes the last, the
     * second element becomes the second to last, and so on.
     *
     * **Note:** This method mutates the wrapped array.
     *
     * @name reverse
     * @memberOf _
     * @category Chain
     * @returns {Object} Returns the new reversed `lodash` wrapper instance.
     * @example
     *
     * var array = [1, 2, 3];
     *
     * _(array).reverse().value()
     * // => [3, 2, 1]
     *
     * console.log(array);
     * // => [3, 2, 1]
     */
    function wrapperReverse() {
      var value = this.__wrapped__;

      var interceptor = function(value) {
        return value.reverse();
      };
      if (value instanceof LazyWrapper) {
        var wrapped = value;
        if (this.__actions__.length) {
          wrapped = new LazyWrapper(this);
        }
        wrapped = wrapped.reverse();
        wrapped.__actions__.push({ 'func': thru, 'args': [interceptor], 'thisArg': undefined });
        return new LodashWrapper(wrapped, this.__chain__);
      }
      return this.thru(interceptor);
    }

    /**
     * Produces the result of coercing the unwrapped value to a string.
     *
     * @name toString
     * @memberOf _
     * @category Chain
     * @returns {string} Returns the coerced string value.
     * @example
     *
     * _([1, 2, 3]).toString();
     * // => '1,2,3'
     */
    function wrapperToString() {
      return (this.value() + '');
    }

    /**
     * Executes the chained sequence to extract the unwrapped value.
     *
     * @name value
     * @memberOf _
     * @alias run, toJSON, valueOf
     * @category Chain
     * @returns {*} Returns the resolved unwrapped value.
     * @example
     *
     * _([1, 2, 3]).value();
     * // => [1, 2, 3]
     */
    function wrapperValue() {
      return baseWrapperValue(this.__wrapped__, this.__actions__);
    }

    /*------------------------------------------------------------------------*/

    /**
     * Creates an array of elements corresponding to the given keys, or indexes,
     * of `collection`. Keys may be specified as individual arguments or as arrays
     * of keys.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {...(number|number[]|string|string[])} [props] The property names
     *  or indexes of elements to pick, specified individually or in arrays.
     * @returns {Array} Returns the new array of picked elements.
     * @example
     *
     * _.at(['a', 'b', 'c'], [0, 2]);
     * // => ['a', 'c']
     *
     * _.at(['barney', 'fred', 'pebbles'], 0, 2);
     * // => ['barney', 'pebbles']
     */
    var at = restParam(function(collection, props) {
      if (isArrayLike(collection)) {
        collection = toIterable(collection);
      }
      return baseAt(collection, baseFlatten(props));
    });

    /**
     * Creates an object composed of keys generated from the results of running
     * each element of `collection` through `iteratee`. The corresponding value
     * of each key is the number of times the key was returned by `iteratee`.
     * The `iteratee` is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns the composed aggregate object.
     * @example
     *
     * _.countBy([4.3, 6.1, 6.4], function(n) {
     *   return Math.floor(n);
     * });
     * // => { '4': 1, '6': 2 }
     *
     * _.countBy([4.3, 6.1, 6.4], function(n) {
     *   return this.floor(n);
     * }, Math);
     * // => { '4': 1, '6': 2 }
     *
     * _.countBy(['one', 'two', 'three'], 'length');
     * // => { '3': 2, '5': 1 }
     */
    var countBy = createAggregator(function(result, value, key) {
      hasOwnProperty.call(result, key) ? ++result[key] : (result[key] = 1);
    });

    /**
     * Checks if `predicate` returns truthy for **all** elements of `collection`.
     * The predicate is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @alias all
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {boolean} Returns `true` if all elements pass the predicate check,
     *  else `false`.
     * @example
     *
     * _.every([true, 1, null, 'yes'], Boolean);
     * // => false
     *
     * var users = [
     *   { 'user': 'barney', 'active': false },
     *   { 'user': 'fred',   'active': false }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.every(users, { 'user': 'barney', 'active': false });
     * // => false
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.every(users, 'active', false);
     * // => true
     *
     * // using the `_.property` callback shorthand
     * _.every(users, 'active');
     * // => false
     */
    function every(collection, predicate, thisArg) {
      var func = isArray(collection) ? arrayEvery : baseEvery;
      if (thisArg && isIterateeCall(collection, predicate, thisArg)) {
        predicate = undefined;
      }
      if (typeof predicate != 'function' || thisArg !== undefined) {
        predicate = getCallback(predicate, thisArg, 3);
      }
      return func(collection, predicate);
    }

    /**
     * Iterates over elements of `collection`, returning an array of all elements
     * `predicate` returns truthy for. The predicate is bound to `thisArg` and
     * invoked with three arguments: (value, index|key, collection).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @alias select
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the new filtered array.
     * @example
     *
     * _.filter([4, 5, 6], function(n) {
     *   return n % 2 == 0;
     * });
     * // => [4, 6]
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36, 'active': true },
     *   { 'user': 'fred',   'age': 40, 'active': false }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.filter(users, { 'age': 36, 'active': true }), 'user');
     * // => ['barney']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.filter(users, 'active', false), 'user');
     * // => ['fred']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.filter(users, 'active'), 'user');
     * // => ['barney']
     */
    function filter(collection, predicate, thisArg) {
      var func = isArray(collection) ? arrayFilter : baseFilter;
      predicate = getCallback(predicate, thisArg, 3);
      return func(collection, predicate);
    }

    /**
     * Iterates over elements of `collection`, returning the first element
     * `predicate` returns truthy for. The predicate is bound to `thisArg` and
     * invoked with three arguments: (value, index|key, collection).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @alias detect
     * @category Collection
     * @param {Array|Object|string} collection The collection to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {*} Returns the matched element, else `undefined`.
     * @example
     *
     * var users = [
     *   { 'user': 'barney',  'age': 36, 'active': true },
     *   { 'user': 'fred',    'age': 40, 'active': false },
     *   { 'user': 'pebbles', 'age': 1,  'active': true }
     * ];
     *
     * _.result(_.find(users, function(chr) {
     *   return chr.age < 40;
     * }), 'user');
     * // => 'barney'
     *
     * // using the `_.matches` callback shorthand
     * _.result(_.find(users, { 'age': 1, 'active': true }), 'user');
     * // => 'pebbles'
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.result(_.find(users, 'active', false), 'user');
     * // => 'fred'
     *
     * // using the `_.property` callback shorthand
     * _.result(_.find(users, 'active'), 'user');
     * // => 'barney'
     */
    var find = createFind(baseEach);

    /**
     * This method is like `_.find` except that it iterates over elements of
     * `collection` from right to left.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {*} Returns the matched element, else `undefined`.
     * @example
     *
     * _.findLast([1, 2, 3, 4], function(n) {
     *   return n % 2 == 1;
     * });
     * // => 3
     */
    var findLast = createFind(baseEachRight, true);

    /**
     * Performs a deep comparison between each element in `collection` and the
     * source object, returning the first element that has equivalent property
     * values.
     *
     * **Note:** This method supports comparing arrays, booleans, `Date` objects,
     * numbers, `Object` objects, regexes, and strings. Objects are compared by
     * their own, not inherited, enumerable properties. For comparing a single
     * own or inherited property value see `_.matchesProperty`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to search.
     * @param {Object} source The object of property values to match.
     * @returns {*} Returns the matched element, else `undefined`.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36, 'active': true },
     *   { 'user': 'fred',   'age': 40, 'active': false }
     * ];
     *
     * _.result(_.findWhere(users, { 'age': 36, 'active': true }), 'user');
     * // => 'barney'
     *
     * _.result(_.findWhere(users, { 'age': 40, 'active': false }), 'user');
     * // => 'fred'
     */
    function findWhere(collection, source) {
      return find(collection, baseMatches(source));
    }

    /**
     * Iterates over elements of `collection` invoking `iteratee` for each element.
     * The `iteratee` is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection). Iteratee functions may exit iteration early
     * by explicitly returning `false`.
     *
     * **Note:** As with other "Collections" methods, objects with a "length" property
     * are iterated like arrays. To avoid this behavior `_.forIn` or `_.forOwn`
     * may be used for object iteration.
     *
     * @static
     * @memberOf _
     * @alias each
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array|Object|string} Returns `collection`.
     * @example
     *
     * _([1, 2]).forEach(function(n) {
     *   console.log(n);
     * }).value();
     * // => logs each value from left to right and returns the array
     *
     * _.forEach({ 'a': 1, 'b': 2 }, function(n, key) {
     *   console.log(n, key);
     * });
     * // => logs each value-key pair and returns the object (iteration order is not guaranteed)
     */
    var forEach = createForEach(arrayEach, baseEach);

    /**
     * This method is like `_.forEach` except that it iterates over elements of
     * `collection` from right to left.
     *
     * @static
     * @memberOf _
     * @alias eachRight
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array|Object|string} Returns `collection`.
     * @example
     *
     * _([1, 2]).forEachRight(function(n) {
     *   console.log(n);
     * }).value();
     * // => logs each value from right to left and returns the array
     */
    var forEachRight = createForEach(arrayEachRight, baseEachRight);

    /**
     * Creates an object composed of keys generated from the results of running
     * each element of `collection` through `iteratee`. The corresponding value
     * of each key is an array of the elements responsible for generating the key.
     * The `iteratee` is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns the composed aggregate object.
     * @example
     *
     * _.groupBy([4.2, 6.1, 6.4], function(n) {
     *   return Math.floor(n);
     * });
     * // => { '4': [4.2], '6': [6.1, 6.4] }
     *
     * _.groupBy([4.2, 6.1, 6.4], function(n) {
     *   return this.floor(n);
     * }, Math);
     * // => { '4': [4.2], '6': [6.1, 6.4] }
     *
     * // using the `_.property` callback shorthand
     * _.groupBy(['one', 'two', 'three'], 'length');
     * // => { '3': ['one', 'two'], '5': ['three'] }
     */
    var groupBy = createAggregator(function(result, value, key) {
      if (hasOwnProperty.call(result, key)) {
        result[key].push(value);
      } else {
        result[key] = [value];
      }
    });

    /**
     * Checks if `target` is in `collection` using
     * [`SameValueZero`](http://ecma-international.org/ecma-262/6.0/#sec-samevaluezero)
     * for equality comparisons. If `fromIndex` is negative, it's used as the offset
     * from the end of `collection`.
     *
     * @static
     * @memberOf _
     * @alias contains, include
     * @category Collection
     * @param {Array|Object|string} collection The collection to search.
     * @param {*} target The value to search for.
     * @param {number} [fromIndex=0] The index to search from.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.reduce`.
     * @returns {boolean} Returns `true` if a matching element is found, else `false`.
     * @example
     *
     * _.includes([1, 2, 3], 1);
     * // => true
     *
     * _.includes([1, 2, 3], 1, 2);
     * // => false
     *
     * _.includes({ 'user': 'fred', 'age': 40 }, 'fred');
     * // => true
     *
     * _.includes('pebbles', 'eb');
     * // => true
     */
    function includes(collection, target, fromIndex, guard) {
      var length = collection ? getLength(collection) : 0;
      if (!isLength(length)) {
        collection = values(collection);
        length = collection.length;
      }
      if (typeof fromIndex != 'number' || (guard && isIterateeCall(target, fromIndex, guard))) {
        fromIndex = 0;
      } else {
        fromIndex = fromIndex < 0 ? nativeMax(length + fromIndex, 0) : (fromIndex || 0);
      }
      return (typeof collection == 'string' || !isArray(collection) && isString(collection))
        ? (fromIndex <= length && collection.indexOf(target, fromIndex) > -1)
        : (!!length && getIndexOf(collection, target, fromIndex) > -1);
    }

    /**
     * Creates an object composed of keys generated from the results of running
     * each element of `collection` through `iteratee`. The corresponding value
     * of each key is the last element responsible for generating the key. The
     * iteratee function is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns the composed aggregate object.
     * @example
     *
     * var keyData = [
     *   { 'dir': 'left', 'code': 97 },
     *   { 'dir': 'right', 'code': 100 }
     * ];
     *
     * _.indexBy(keyData, 'dir');
     * // => { 'left': { 'dir': 'left', 'code': 97 }, 'right': { 'dir': 'right', 'code': 100 } }
     *
     * _.indexBy(keyData, function(object) {
     *   return String.fromCharCode(object.code);
     * });
     * // => { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } }
     *
     * _.indexBy(keyData, function(object) {
     *   return this.fromCharCode(object.code);
     * }, String);
     * // => { 'a': { 'dir': 'left', 'code': 97 }, 'd': { 'dir': 'right', 'code': 100 } }
     */
    var indexBy = createAggregator(function(result, value, key) {
      result[key] = value;
    });

    /**
     * Invokes the method at `path` of each element in `collection`, returning
     * an array of the results of each invoked method. Any additional arguments
     * are provided to each invoked method. If `methodName` is a function it's
     * invoked for, and `this` bound to, each element in `collection`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Array|Function|string} path The path of the method to invoke or
     *  the function invoked per iteration.
     * @param {...*} [args] The arguments to invoke the method with.
     * @returns {Array} Returns the array of results.
     * @example
     *
     * _.invoke([[5, 1, 7], [3, 2, 1]], 'sort');
     * // => [[1, 5, 7], [1, 2, 3]]
     *
     * _.invoke([123, 456], String.prototype.split, '');
     * // => [['1', '2', '3'], ['4', '5', '6']]
     */
    var invoke = restParam(function(collection, path, args) {
      var index = -1,
          isFunc = typeof path == 'function',
          isProp = isKey(path),
          result = isArrayLike(collection) ? Array(collection.length) : [];

      baseEach(collection, function(value) {
        var func = isFunc ? path : ((isProp && value != null) ? value[path] : undefined);
        result[++index] = func ? func.apply(value, args) : invokePath(value, path, args);
      });
      return result;
    });

    /**
     * Creates an array of values by running each element in `collection` through
     * `iteratee`. The `iteratee` is bound to `thisArg` and invoked with three
     * arguments: (value, index|key, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * Many lodash methods are guarded to work as iteratees for methods like
     * `_.every`, `_.filter`, `_.map`, `_.mapValues`, `_.reject`, and `_.some`.
     *
     * The guarded methods are:
     * `ary`, `callback`, `chunk`, `clone`, `create`, `curry`, `curryRight`,
     * `drop`, `dropRight`, `every`, `fill`, `flatten`, `invert`, `max`, `min`,
     * `parseInt`, `slice`, `sortBy`, `take`, `takeRight`, `template`, `trim`,
     * `trimLeft`, `trimRight`, `trunc`, `random`, `range`, `sample`, `some`,
     * `sum`, `uniq`, and `words`
     *
     * @static
     * @memberOf _
     * @alias collect
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the new mapped array.
     * @example
     *
     * function timesThree(n) {
     *   return n * 3;
     * }
     *
     * _.map([1, 2], timesThree);
     * // => [3, 6]
     *
     * _.map({ 'a': 1, 'b': 2 }, timesThree);
     * // => [3, 6] (iteration order is not guaranteed)
     *
     * var users = [
     *   { 'user': 'barney' },
     *   { 'user': 'fred' }
     * ];
     *
     * // using the `_.property` callback shorthand
     * _.map(users, 'user');
     * // => ['barney', 'fred']
     */
    function map(collection, iteratee, thisArg) {
      var func = isArray(collection) ? arrayMap : baseMap;
      iteratee = getCallback(iteratee, thisArg, 3);
      return func(collection, iteratee);
    }

    /**
     * Creates an array of elements split into two groups, the first of which
     * contains elements `predicate` returns truthy for, while the second of which
     * contains elements `predicate` returns falsey for. The predicate is bound
     * to `thisArg` and invoked with three arguments: (value, index|key, collection).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the array of grouped elements.
     * @example
     *
     * _.partition([1, 2, 3], function(n) {
     *   return n % 2;
     * });
     * // => [[1, 3], [2]]
     *
     * _.partition([1.2, 2.3, 3.4], function(n) {
     *   return this.floor(n) % 2;
     * }, Math);
     * // => [[1.2, 3.4], [2.3]]
     *
     * var users = [
     *   { 'user': 'barney',  'age': 36, 'active': false },
     *   { 'user': 'fred',    'age': 40, 'active': true },
     *   { 'user': 'pebbles', 'age': 1,  'active': false }
     * ];
     *
     * var mapper = function(array) {
     *   return _.pluck(array, 'user');
     * };
     *
     * // using the `_.matches` callback shorthand
     * _.map(_.partition(users, { 'age': 1, 'active': false }), mapper);
     * // => [['pebbles'], ['barney', 'fred']]
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.map(_.partition(users, 'active', false), mapper);
     * // => [['barney', 'pebbles'], ['fred']]
     *
     * // using the `_.property` callback shorthand
     * _.map(_.partition(users, 'active'), mapper);
     * // => [['fred'], ['barney', 'pebbles']]
     */
    var partition = createAggregator(function(result, value, key) {
      result[key ? 0 : 1].push(value);
    }, function() { return [[], []]; });

    /**
     * Gets the property value of `path` from all elements in `collection`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Array|string} path The path of the property to pluck.
     * @returns {Array} Returns the property values.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 40 }
     * ];
     *
     * _.pluck(users, 'user');
     * // => ['barney', 'fred']
     *
     * var userIndex = _.indexBy(users, 'user');
     * _.pluck(userIndex, 'age');
     * // => [36, 40] (iteration order is not guaranteed)
     */
    function pluck(collection, path) {
      return map(collection, property(path));
    }

    /**
     * Reduces `collection` to a value which is the accumulated result of running
     * each element in `collection` through `iteratee`, where each successive
     * invocation is supplied the return value of the previous. If `accumulator`
     * is not provided the first element of `collection` is used as the initial
     * value. The `iteratee` is bound to `thisArg` and invoked with four arguments:
     * (accumulator, value, index|key, collection).
     *
     * Many lodash methods are guarded to work as iteratees for methods like
     * `_.reduce`, `_.reduceRight`, and `_.transform`.
     *
     * The guarded methods are:
     * `assign`, `defaults`, `defaultsDeep`, `includes`, `merge`, `sortByAll`,
     * and `sortByOrder`
     *
     * @static
     * @memberOf _
     * @alias foldl, inject
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [accumulator] The initial value.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {*} Returns the accumulated value.
     * @example
     *
     * _.reduce([1, 2], function(total, n) {
     *   return total + n;
     * });
     * // => 3
     *
     * _.reduce({ 'a': 1, 'b': 2 }, function(result, n, key) {
     *   result[key] = n * 3;
     *   return result;
     * }, {});
     * // => { 'a': 3, 'b': 6 } (iteration order is not guaranteed)
     */
    var reduce = createReduce(arrayReduce, baseEach);

    /**
     * This method is like `_.reduce` except that it iterates over elements of
     * `collection` from right to left.
     *
     * @static
     * @memberOf _
     * @alias foldr
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [accumulator] The initial value.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {*} Returns the accumulated value.
     * @example
     *
     * var array = [[0, 1], [2, 3], [4, 5]];
     *
     * _.reduceRight(array, function(flattened, other) {
     *   return flattened.concat(other);
     * }, []);
     * // => [4, 5, 2, 3, 0, 1]
     */
    var reduceRight = createReduce(arrayReduceRight, baseEachRight);

    /**
     * The opposite of `_.filter`; this method returns the elements of `collection`
     * that `predicate` does **not** return truthy for.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Array} Returns the new filtered array.
     * @example
     *
     * _.reject([1, 2, 3, 4], function(n) {
     *   return n % 2 == 0;
     * });
     * // => [1, 3]
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36, 'active': false },
     *   { 'user': 'fred',   'age': 40, 'active': true }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.pluck(_.reject(users, { 'age': 40, 'active': true }), 'user');
     * // => ['barney']
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.pluck(_.reject(users, 'active', false), 'user');
     * // => ['fred']
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.reject(users, 'active'), 'user');
     * // => ['barney']
     */
    function reject(collection, predicate, thisArg) {
      var func = isArray(collection) ? arrayFilter : baseFilter;
      predicate = getCallback(predicate, thisArg, 3);
      return func(collection, function(value, index, collection) {
        return !predicate(value, index, collection);
      });
    }

    /**
     * Gets a random element or `n` random elements from a collection.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to sample.
     * @param {number} [n] The number of elements to sample.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {*} Returns the random sample(s).
     * @example
     *
     * _.sample([1, 2, 3, 4]);
     * // => 2
     *
     * _.sample([1, 2, 3, 4], 2);
     * // => [3, 1]
     */
    function sample(collection, n, guard) {
      if (guard ? isIterateeCall(collection, n, guard) : n == null) {
        collection = toIterable(collection);
        var length = collection.length;
        return length > 0 ? collection[baseRandom(0, length - 1)] : undefined;
      }
      var index = -1,
          result = toArray(collection),
          length = result.length,
          lastIndex = length - 1;

      n = nativeMin(n < 0 ? 0 : (+n || 0), length);
      while (++index < n) {
        var rand = baseRandom(index, lastIndex),
            value = result[rand];

        result[rand] = result[index];
        result[index] = value;
      }
      result.length = n;
      return result;
    }

    /**
     * Creates an array of shuffled values, using a version of the
     * [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher-Yates_shuffle).
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to shuffle.
     * @returns {Array} Returns the new shuffled array.
     * @example
     *
     * _.shuffle([1, 2, 3, 4]);
     * // => [4, 1, 3, 2]
     */
    function shuffle(collection) {
      return sample(collection, POSITIVE_INFINITY);
    }

    /**
     * Gets the size of `collection` by returning its length for array-like
     * values or the number of own enumerable properties for objects.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to inspect.
     * @returns {number} Returns the size of `collection`.
     * @example
     *
     * _.size([1, 2, 3]);
     * // => 3
     *
     * _.size({ 'a': 1, 'b': 2 });
     * // => 2
     *
     * _.size('pebbles');
     * // => 7
     */
    function size(collection) {
      var length = collection ? getLength(collection) : 0;
      return isLength(length) ? length : keys(collection).length;
    }

    /**
     * Checks if `predicate` returns truthy for **any** element of `collection`.
     * The function returns as soon as it finds a passing value and does not iterate
     * over the entire collection. The predicate is bound to `thisArg` and invoked
     * with three arguments: (value, index|key, collection).
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @alias any
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {boolean} Returns `true` if any element passes the predicate check,
     *  else `false`.
     * @example
     *
     * _.some([null, 0, 'yes', false], Boolean);
     * // => true
     *
     * var users = [
     *   { 'user': 'barney', 'active': true },
     *   { 'user': 'fred',   'active': false }
     * ];
     *
     * // using the `_.matches` callback shorthand
     * _.some(users, { 'user': 'barney', 'active': false });
     * // => false
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.some(users, 'active', false);
     * // => true
     *
     * // using the `_.property` callback shorthand
     * _.some(users, 'active');
     * // => true
     */
    function some(collection, predicate, thisArg) {
      var func = isArray(collection) ? arraySome : baseSome;
      if (thisArg && isIterateeCall(collection, predicate, thisArg)) {
        predicate = undefined;
      }
      if (typeof predicate != 'function' || thisArg !== undefined) {
        predicate = getCallback(predicate, thisArg, 3);
      }
      return func(collection, predicate);
    }

    /**
     * Creates an array of elements, sorted in ascending order by the results of
     * running each element in a collection through `iteratee`. This method performs
     * a stable sort, that is, it preserves the original sort order of equal elements.
     * The `iteratee` is bound to `thisArg` and invoked with three arguments:
     * (value, index|key, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the new sorted array.
     * @example
     *
     * _.sortBy([1, 2, 3], function(n) {
     *   return Math.sin(n);
     * });
     * // => [3, 1, 2]
     *
     * _.sortBy([1, 2, 3], function(n) {
     *   return this.sin(n);
     * }, Math);
     * // => [3, 1, 2]
     *
     * var users = [
     *   { 'user': 'fred' },
     *   { 'user': 'pebbles' },
     *   { 'user': 'barney' }
     * ];
     *
     * // using the `_.property` callback shorthand
     * _.pluck(_.sortBy(users, 'user'), 'user');
     * // => ['barney', 'fred', 'pebbles']
     */
    function sortBy(collection, iteratee, thisArg) {
      if (collection == null) {
        return [];
      }
      if (thisArg && isIterateeCall(collection, iteratee, thisArg)) {
        iteratee = undefined;
      }
      var index = -1;
      iteratee = getCallback(iteratee, thisArg, 3);

      var result = baseMap(collection, function(value, key, collection) {
        return { 'criteria': iteratee(value, key, collection), 'index': ++index, 'value': value };
      });
      return baseSortBy(result, compareAscending);
    }

    /**
     * This method is like `_.sortBy` except that it can sort by multiple iteratees
     * or property names.
     *
     * If a property name is provided for an iteratee the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If an object is provided for an iteratee the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {...(Function|Function[]|Object|Object[]|string|string[])} iteratees
     *  The iteratees to sort by, specified as individual values or arrays of values.
     * @returns {Array} Returns the new sorted array.
     * @example
     *
     * var users = [
     *   { 'user': 'fred',   'age': 48 },
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 42 },
     *   { 'user': 'barney', 'age': 34 }
     * ];
     *
     * _.map(_.sortByAll(users, ['user', 'age']), _.values);
     * // => [['barney', 34], ['barney', 36], ['fred', 42], ['fred', 48]]
     *
     * _.map(_.sortByAll(users, 'user', function(chr) {
     *   return Math.floor(chr.age / 10);
     * }), _.values);
     * // => [['barney', 36], ['barney', 34], ['fred', 48], ['fred', 42]]
     */
    var sortByAll = restParam(function(collection, iteratees) {
      if (collection == null) {
        return [];
      }
      var guard = iteratees[2];
      if (guard && isIterateeCall(iteratees[0], iteratees[1], guard)) {
        iteratees.length = 1;
      }
      return baseSortByOrder(collection, baseFlatten(iteratees), []);
    });

    /**
     * This method is like `_.sortByAll` except that it allows specifying the
     * sort orders of the iteratees to sort by. If `orders` is unspecified, all
     * values are sorted in ascending order. Otherwise, a value is sorted in
     * ascending order if its corresponding order is "asc", and descending if "desc".
     *
     * If a property name is provided for an iteratee the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If an object is provided for an iteratee the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function[]|Object[]|string[]} iteratees The iteratees to sort by.
     * @param {boolean[]} [orders] The sort orders of `iteratees`.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.reduce`.
     * @returns {Array} Returns the new sorted array.
     * @example
     *
     * var users = [
     *   { 'user': 'fred',   'age': 48 },
     *   { 'user': 'barney', 'age': 34 },
     *   { 'user': 'fred',   'age': 42 },
     *   { 'user': 'barney', 'age': 36 }
     * ];
     *
     * // sort by `user` in ascending order and by `age` in descending order
     * _.map(_.sortByOrder(users, ['user', 'age'], ['asc', 'desc']), _.values);
     * // => [['barney', 36], ['barney', 34], ['fred', 48], ['fred', 42]]
     */
    function sortByOrder(collection, iteratees, orders, guard) {
      if (collection == null) {
        return [];
      }
      if (guard && isIterateeCall(iteratees, orders, guard)) {
        orders = undefined;
      }
      if (!isArray(iteratees)) {
        iteratees = iteratees == null ? [] : [iteratees];
      }
      if (!isArray(orders)) {
        orders = orders == null ? [] : [orders];
      }
      return baseSortByOrder(collection, iteratees, orders);
    }

    /**
     * Performs a deep comparison between each element in `collection` and the
     * source object, returning an array of all elements that have equivalent
     * property values.
     *
     * **Note:** This method supports comparing arrays, booleans, `Date` objects,
     * numbers, `Object` objects, regexes, and strings. Objects are compared by
     * their own, not inherited, enumerable properties. For comparing a single
     * own or inherited property value see `_.matchesProperty`.
     *
     * @static
     * @memberOf _
     * @category Collection
     * @param {Array|Object|string} collection The collection to search.
     * @param {Object} source The object of property values to match.
     * @returns {Array} Returns the new filtered array.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36, 'active': false, 'pets': ['hoppy'] },
     *   { 'user': 'fred',   'age': 40, 'active': true, 'pets': ['baby puss', 'dino'] }
     * ];
     *
     * _.pluck(_.where(users, { 'age': 36, 'active': false }), 'user');
     * // => ['barney']
     *
     * _.pluck(_.where(users, { 'pets': ['dino'] }), 'user');
     * // => ['fred']
     */
    function where(collection, source) {
      return filter(collection, baseMatches(source));
    }

    /*------------------------------------------------------------------------*/

    /**
     * Gets the number of milliseconds that have elapsed since the Unix epoch
     * (1 January 1970 00:00:00 UTC).
     *
     * @static
     * @memberOf _
     * @category Date
     * @example
     *
     * _.defer(function(stamp) {
     *   console.log(_.now() - stamp);
     * }, _.now());
     * // => logs the number of milliseconds it took for the deferred function to be invoked
     */
    var now = nativeNow || function() {
      return new Date().getTime();
    };

    /*------------------------------------------------------------------------*/

    /**
     * The opposite of `_.before`; this method creates a function that invokes
     * `func` once it's called `n` or more times.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {number} n The number of calls before `func` is invoked.
     * @param {Function} func The function to restrict.
     * @returns {Function} Returns the new restricted function.
     * @example
     *
     * var saves = ['profile', 'settings'];
     *
     * var done = _.after(saves.length, function() {
     *   console.log('done saving!');
     * });
     *
     * _.forEach(saves, function(type) {
     *   asyncSave({ 'type': type, 'complete': done });
     * });
     * // => logs 'done saving!' after the two async saves have completed
     */
    function after(n, func) {
      if (typeof func != 'function') {
        if (typeof n == 'function') {
          var temp = n;
          n = func;
          func = temp;
        } else {
          throw new TypeError(FUNC_ERROR_TEXT);
        }
      }
      n = nativeIsFinite(n = +n) ? n : 0;
      return function() {
        if (--n < 1) {
          return func.apply(this, arguments);
        }
      };
    }

    /**
     * Creates a function that accepts up to `n` arguments ignoring any
     * additional arguments.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to cap arguments for.
     * @param {number} [n=func.length] The arity cap.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Function} Returns the new function.
     * @example
     *
     * _.map(['6', '8', '10'], _.ary(parseInt, 1));
     * // => [6, 8, 10]
     */
    function ary(func, n, guard) {
      if (guard && isIterateeCall(func, n, guard)) {
        n = undefined;
      }
      n = (func && n == null) ? func.length : nativeMax(+n || 0, 0);
      return createWrapper(func, ARY_FLAG, undefined, undefined, undefined, undefined, n);
    }

    /**
     * Creates a function that invokes `func`, with the `this` binding and arguments
     * of the created function, while it's called less than `n` times. Subsequent
     * calls to the created function return the result of the last `func` invocation.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {number} n The number of calls at which `func` is no longer invoked.
     * @param {Function} func The function to restrict.
     * @returns {Function} Returns the new restricted function.
     * @example
     *
     * jQuery('#add').on('click', _.before(5, addContactToList));
     * // => allows adding up to 4 contacts to the list
     */
    function before(n, func) {
      var result;
      if (typeof func != 'function') {
        if (typeof n == 'function') {
          var temp = n;
          n = func;
          func = temp;
        } else {
          throw new TypeError(FUNC_ERROR_TEXT);
        }
      }
      return function() {
        if (--n > 0) {
          result = func.apply(this, arguments);
        }
        if (n <= 1) {
          func = undefined;
        }
        return result;
      };
    }

    /**
     * Creates a function that invokes `func` with the `this` binding of `thisArg`
     * and prepends any additional `_.bind` arguments to those provided to the
     * bound function.
     *
     * The `_.bind.placeholder` value, which defaults to `_` in monolithic builds,
     * may be used as a placeholder for partially applied arguments.
     *
     * **Note:** Unlike native `Function#bind` this method does not set the "length"
     * property of bound functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to bind.
     * @param {*} thisArg The `this` binding of `func`.
     * @param {...*} [partials] The arguments to be partially applied.
     * @returns {Function} Returns the new bound function.
     * @example
     *
     * var greet = function(greeting, punctuation) {
     *   return greeting + ' ' + this.user + punctuation;
     * };
     *
     * var object = { 'user': 'fred' };
     *
     * var bound = _.bind(greet, object, 'hi');
     * bound('!');
     * // => 'hi fred!'
     *
     * // using placeholders
     * var bound = _.bind(greet, object, _, '!');
     * bound('hi');
     * // => 'hi fred!'
     */
    var bind = restParam(function(func, thisArg, partials) {
      var bitmask = BIND_FLAG;
      if (partials.length) {
        var holders = replaceHolders(partials, bind.placeholder);
        bitmask |= PARTIAL_FLAG;
      }
      return createWrapper(func, bitmask, thisArg, partials, holders);
    });

    /**
     * Binds methods of an object to the object itself, overwriting the existing
     * method. Method names may be specified as individual arguments or as arrays
     * of method names. If no method names are provided all enumerable function
     * properties, own and inherited, of `object` are bound.
     *
     * **Note:** This method does not set the "length" property of bound functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Object} object The object to bind and assign the bound methods to.
     * @param {...(string|string[])} [methodNames] The object method names to bind,
     *  specified as individual method names or arrays of method names.
     * @returns {Object} Returns `object`.
     * @example
     *
     * var view = {
     *   'label': 'docs',
     *   'onClick': function() {
     *     console.log('clicked ' + this.label);
     *   }
     * };
     *
     * _.bindAll(view);
     * jQuery('#docs').on('click', view.onClick);
     * // => logs 'clicked docs' when the element is clicked
     */
    var bindAll = restParam(function(object, methodNames) {
      methodNames = methodNames.length ? baseFlatten(methodNames) : functions(object);

      var index = -1,
          length = methodNames.length;

      while (++index < length) {
        var key = methodNames[index];
        object[key] = createWrapper(object[key], BIND_FLAG, object);
      }
      return object;
    });

    /**
     * Creates a function that invokes the method at `object[key]` and prepends
     * any additional `_.bindKey` arguments to those provided to the bound function.
     *
     * This method differs from `_.bind` by allowing bound functions to reference
     * methods that may be redefined or don't yet exist.
     * See [Peter Michaux's article](http://peter.michaux.ca/articles/lazy-function-definition-pattern)
     * for more details.
     *
     * The `_.bindKey.placeholder` value, which defaults to `_` in monolithic
     * builds, may be used as a placeholder for partially applied arguments.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Object} object The object the method belongs to.
     * @param {string} key The key of the method.
     * @param {...*} [partials] The arguments to be partially applied.
     * @returns {Function} Returns the new bound function.
     * @example
     *
     * var object = {
     *   'user': 'fred',
     *   'greet': function(greeting, punctuation) {
     *     return greeting + ' ' + this.user + punctuation;
     *   }
     * };
     *
     * var bound = _.bindKey(object, 'greet', 'hi');
     * bound('!');
     * // => 'hi fred!'
     *
     * object.greet = function(greeting, punctuation) {
     *   return greeting + 'ya ' + this.user + punctuation;
     * };
     *
     * bound('!');
     * // => 'hiya fred!'
     *
     * // using placeholders
     * var bound = _.bindKey(object, 'greet', _, '!');
     * bound('hi');
     * // => 'hiya fred!'
     */
    var bindKey = restParam(function(object, key, partials) {
      var bitmask = BIND_FLAG | BIND_KEY_FLAG;
      if (partials.length) {
        var holders = replaceHolders(partials, bindKey.placeholder);
        bitmask |= PARTIAL_FLAG;
      }
      return createWrapper(key, bitmask, object, partials, holders);
    });

    /**
     * Creates a function that accepts one or more arguments of `func` that when
     * called either invokes `func` returning its result, if all `func` arguments
     * have been provided, or returns a function that accepts one or more of the
     * remaining `func` arguments, and so on. The arity of `func` may be specified
     * if `func.length` is not sufficient.
     *
     * The `_.curry.placeholder` value, which defaults to `_` in monolithic builds,
     * may be used as a placeholder for provided arguments.
     *
     * **Note:** This method does not set the "length" property of curried functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to curry.
     * @param {number} [arity=func.length] The arity of `func`.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Function} Returns the new curried function.
     * @example
     *
     * var abc = function(a, b, c) {
     *   return [a, b, c];
     * };
     *
     * var curried = _.curry(abc);
     *
     * curried(1)(2)(3);
     * // => [1, 2, 3]
     *
     * curried(1, 2)(3);
     * // => [1, 2, 3]
     *
     * curried(1, 2, 3);
     * // => [1, 2, 3]
     *
     * // using placeholders
     * curried(1)(_, 3)(2);
     * // => [1, 2, 3]
     */
    var curry = createCurry(CURRY_FLAG);

    /**
     * This method is like `_.curry` except that arguments are applied to `func`
     * in the manner of `_.partialRight` instead of `_.partial`.
     *
     * The `_.curryRight.placeholder` value, which defaults to `_` in monolithic
     * builds, may be used as a placeholder for provided arguments.
     *
     * **Note:** This method does not set the "length" property of curried functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to curry.
     * @param {number} [arity=func.length] The arity of `func`.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Function} Returns the new curried function.
     * @example
     *
     * var abc = function(a, b, c) {
     *   return [a, b, c];
     * };
     *
     * var curried = _.curryRight(abc);
     *
     * curried(3)(2)(1);
     * // => [1, 2, 3]
     *
     * curried(2, 3)(1);
     * // => [1, 2, 3]
     *
     * curried(1, 2, 3);
     * // => [1, 2, 3]
     *
     * // using placeholders
     * curried(3)(1, _)(2);
     * // => [1, 2, 3]
     */
    var curryRight = createCurry(CURRY_RIGHT_FLAG);

    /**
     * Creates a debounced function that delays invoking `func` until after `wait`
     * milliseconds have elapsed since the last time the debounced function was
     * invoked. The debounced function comes with a `cancel` method to cancel
     * delayed invocations. Provide an options object to indicate that `func`
     * should be invoked on the leading and/or trailing edge of the `wait` timeout.
     * Subsequent calls to the debounced function return the result of the last
     * `func` invocation.
     *
     * **Note:** If `leading` and `trailing` options are `true`, `func` is invoked
     * on the trailing edge of the timeout only if the the debounced function is
     * invoked more than once during the `wait` timeout.
     *
     * See [David Corbacho's article](http://drupalmotion.com/article/debounce-and-throttle-visual-explanation)
     * for details over the differences between `_.debounce` and `_.throttle`.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to debounce.
     * @param {number} [wait=0] The number of milliseconds to delay.
     * @param {Object} [options] The options object.
     * @param {boolean} [options.leading=false] Specify invoking on the leading
     *  edge of the timeout.
     * @param {number} [options.maxWait] The maximum time `func` is allowed to be
     *  delayed before it's invoked.
     * @param {boolean} [options.trailing=true] Specify invoking on the trailing
     *  edge of the timeout.
     * @returns {Function} Returns the new debounced function.
     * @example
     *
     * // avoid costly calculations while the window size is in flux
     * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
     *
     * // invoke `sendMail` when the click event is fired, debouncing subsequent calls
     * jQuery('#postbox').on('click', _.debounce(sendMail, 300, {
     *   'leading': true,
     *   'trailing': false
     * }));
     *
     * // ensure `batchLog` is invoked once after 1 second of debounced calls
     * var source = new EventSource('/stream');
     * jQuery(source).on('message', _.debounce(batchLog, 250, {
     *   'maxWait': 1000
     * }));
     *
     * // cancel a debounced call
     * var todoChanges = _.debounce(batchLog, 1000);
     * Object.observe(models.todo, todoChanges);
     *
     * Object.observe(models, function(changes) {
     *   if (_.find(changes, { 'user': 'todo', 'type': 'delete'})) {
     *     todoChanges.cancel();
     *   }
     * }, ['delete']);
     *
     * // ...at some point `models.todo` is changed
     * models.todo.completed = true;
     *
     * // ...before 1 second has passed `models.todo` is deleted
     * // which cancels the debounced `todoChanges` call
     * delete models.todo;
     */
    function debounce(func, wait, options) {
      var args,
          maxTimeoutId,
          result,
          stamp,
          thisArg,
          timeoutId,
          trailingCall,
          lastCalled = 0,
          maxWait = false,
          trailing = true;

      if (typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      wait = wait < 0 ? 0 : (+wait || 0);
      if (options === true) {
        var leading = true;
        trailing = false;
      } else if (isObject(options)) {
        leading = !!options.leading;
        maxWait = 'maxWait' in options && nativeMax(+options.maxWait || 0, wait);
        trailing = 'trailing' in options ? !!options.trailing : trailing;
      }

      function cancel() {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (maxTimeoutId) {
          clearTimeout(maxTimeoutId);
        }
        lastCalled = 0;
        maxTimeoutId = timeoutId = trailingCall = undefined;
      }

      function complete(isCalled, id) {
        if (id) {
          clearTimeout(id);
        }
        maxTimeoutId = timeoutId = trailingCall = undefined;
        if (isCalled) {
          lastCalled = now();
          result = func.apply(thisArg, args);
          if (!timeoutId && !maxTimeoutId) {
            args = thisArg = undefined;
          }
        }
      }

      function delayed() {
        var remaining = wait - (now() - stamp);
        if (remaining <= 0 || remaining > wait) {
          complete(trailingCall, maxTimeoutId);
        } else {
          timeoutId = setTimeout(delayed, remaining);
        }
      }

      function maxDelayed() {
        complete(trailing, timeoutId);
      }

      function debounced() {
        args = arguments;
        stamp = now();
        thisArg = this;
        trailingCall = trailing && (timeoutId || !leading);

        if (maxWait === false) {
          var leadingCall = leading && !timeoutId;
        } else {
          if (!maxTimeoutId && !leading) {
            lastCalled = stamp;
          }
          var remaining = maxWait - (stamp - lastCalled),
              isCalled = remaining <= 0 || remaining > maxWait;

          if (isCalled) {
            if (maxTimeoutId) {
              maxTimeoutId = clearTimeout(maxTimeoutId);
            }
            lastCalled = stamp;
            result = func.apply(thisArg, args);
          }
          else if (!maxTimeoutId) {
            maxTimeoutId = setTimeout(maxDelayed, remaining);
          }
        }
        if (isCalled && timeoutId) {
          timeoutId = clearTimeout(timeoutId);
        }
        else if (!timeoutId && wait !== maxWait) {
          timeoutId = setTimeout(delayed, wait);
        }
        if (leadingCall) {
          isCalled = true;
          result = func.apply(thisArg, args);
        }
        if (isCalled && !timeoutId && !maxTimeoutId) {
          args = thisArg = undefined;
        }
        return result;
      }
      debounced.cancel = cancel;
      return debounced;
    }

    /**
     * Defers invoking the `func` until the current call stack has cleared. Any
     * additional arguments are provided to `func` when it's invoked.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to defer.
     * @param {...*} [args] The arguments to invoke the function with.
     * @returns {number} Returns the timer id.
     * @example
     *
     * _.defer(function(text) {
     *   console.log(text);
     * }, 'deferred');
     * // logs 'deferred' after one or more milliseconds
     */
    var defer = restParam(function(func, args) {
      return baseDelay(func, 1, args);
    });

    /**
     * Invokes `func` after `wait` milliseconds. Any additional arguments are
     * provided to `func` when it's invoked.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to delay.
     * @param {number} wait The number of milliseconds to delay invocation.
     * @param {...*} [args] The arguments to invoke the function with.
     * @returns {number} Returns the timer id.
     * @example
     *
     * _.delay(function(text) {
     *   console.log(text);
     * }, 1000, 'later');
     * // => logs 'later' after one second
     */
    var delay = restParam(function(func, wait, args) {
      return baseDelay(func, wait, args);
    });

    /**
     * Creates a function that returns the result of invoking the provided
     * functions with the `this` binding of the created function, where each
     * successive invocation is supplied the return value of the previous.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {...Function} [funcs] Functions to invoke.
     * @returns {Function} Returns the new function.
     * @example
     *
     * function square(n) {
     *   return n * n;
     * }
     *
     * var addSquare = _.flow(_.add, square);
     * addSquare(1, 2);
     * // => 9
     */
    var flow = createFlow();

    /**
     * This method is like `_.flow` except that it creates a function that
     * invokes the provided functions from right to left.
     *
     * @static
     * @memberOf _
     * @alias backflow, compose
     * @category Function
     * @param {...Function} [funcs] Functions to invoke.
     * @returns {Function} Returns the new function.
     * @example
     *
     * function square(n) {
     *   return n * n;
     * }
     *
     * var addSquare = _.flowRight(square, _.add);
     * addSquare(1, 2);
     * // => 9
     */
    var flowRight = createFlow(true);

    /**
     * Creates a function that memoizes the result of `func`. If `resolver` is
     * provided it determines the cache key for storing the result based on the
     * arguments provided to the memoized function. By default, the first argument
     * provided to the memoized function is coerced to a string and used as the
     * cache key. The `func` is invoked with the `this` binding of the memoized
     * function.
     *
     * **Note:** The cache is exposed as the `cache` property on the memoized
     * function. Its creation may be customized by replacing the `_.memoize.Cache`
     * constructor with one whose instances implement the [`Map`](http://ecma-international.org/ecma-262/6.0/#sec-properties-of-the-map-prototype-object)
     * method interface of `get`, `has`, and `set`.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to have its output memoized.
     * @param {Function} [resolver] The function to resolve the cache key.
     * @returns {Function} Returns the new memoizing function.
     * @example
     *
     * var upperCase = _.memoize(function(string) {
     *   return string.toUpperCase();
     * });
     *
     * upperCase('fred');
     * // => 'FRED'
     *
     * // modifying the result cache
     * upperCase.cache.set('fred', 'BARNEY');
     * upperCase('fred');
     * // => 'BARNEY'
     *
     * // replacing `_.memoize.Cache`
     * var object = { 'user': 'fred' };
     * var other = { 'user': 'barney' };
     * var identity = _.memoize(_.identity);
     *
     * identity(object);
     * // => { 'user': 'fred' }
     * identity(other);
     * // => { 'user': 'fred' }
     *
     * _.memoize.Cache = WeakMap;
     * var identity = _.memoize(_.identity);
     *
     * identity(object);
     * // => { 'user': 'fred' }
     * identity(other);
     * // => { 'user': 'barney' }
     */
    function memoize(func, resolver) {
      if (typeof func != 'function' || (resolver && typeof resolver != 'function')) {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      var memoized = function() {
        var args = arguments,
            key = resolver ? resolver.apply(this, args) : args[0],
            cache = memoized.cache;

        if (cache.has(key)) {
          return cache.get(key);
        }
        var result = func.apply(this, args);
        memoized.cache = cache.set(key, result);
        return result;
      };
      memoized.cache = new memoize.Cache;
      return memoized;
    }

    /**
     * Creates a function that runs each argument through a corresponding
     * transform function.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to wrap.
     * @param {...(Function|Function[])} [transforms] The functions to transform
     * arguments, specified as individual functions or arrays of functions.
     * @returns {Function} Returns the new function.
     * @example
     *
     * function doubled(n) {
     *   return n * 2;
     * }
     *
     * function square(n) {
     *   return n * n;
     * }
     *
     * var modded = _.modArgs(function(x, y) {
     *   return [x, y];
     * }, square, doubled);
     *
     * modded(1, 2);
     * // => [1, 4]
     *
     * modded(5, 10);
     * // => [25, 20]
     */
    var modArgs = restParam(function(func, transforms) {
      transforms = baseFlatten(transforms);
      if (typeof func != 'function' || !arrayEvery(transforms, baseIsFunction)) {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      var length = transforms.length;
      return restParam(function(args) {
        var index = nativeMin(args.length, length);
        while (index--) {
          args[index] = transforms[index](args[index]);
        }
        return func.apply(this, args);
      });
    });

    /**
     * Creates a function that negates the result of the predicate `func`. The
     * `func` predicate is invoked with the `this` binding and arguments of the
     * created function.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} predicate The predicate to negate.
     * @returns {Function} Returns the new function.
     * @example
     *
     * function isEven(n) {
     *   return n % 2 == 0;
     * }
     *
     * _.filter([1, 2, 3, 4, 5, 6], _.negate(isEven));
     * // => [1, 3, 5]
     */
    function negate(predicate) {
      if (typeof predicate != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      return function() {
        return !predicate.apply(this, arguments);
      };
    }

    /**
     * Creates a function that is restricted to invoking `func` once. Repeat calls
     * to the function return the value of the first call. The `func` is invoked
     * with the `this` binding and arguments of the created function.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to restrict.
     * @returns {Function} Returns the new restricted function.
     * @example
     *
     * var initialize = _.once(createApplication);
     * initialize();
     * initialize();
     * // `initialize` invokes `createApplication` once
     */
    function once(func) {
      return before(2, func);
    }

    /**
     * Creates a function that invokes `func` with `partial` arguments prepended
     * to those provided to the new function. This method is like `_.bind` except
     * it does **not** alter the `this` binding.
     *
     * The `_.partial.placeholder` value, which defaults to `_` in monolithic
     * builds, may be used as a placeholder for partially applied arguments.
     *
     * **Note:** This method does not set the "length" property of partially
     * applied functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to partially apply arguments to.
     * @param {...*} [partials] The arguments to be partially applied.
     * @returns {Function} Returns the new partially applied function.
     * @example
     *
     * var greet = function(greeting, name) {
     *   return greeting + ' ' + name;
     * };
     *
     * var sayHelloTo = _.partial(greet, 'hello');
     * sayHelloTo('fred');
     * // => 'hello fred'
     *
     * // using placeholders
     * var greetFred = _.partial(greet, _, 'fred');
     * greetFred('hi');
     * // => 'hi fred'
     */
    var partial = createPartial(PARTIAL_FLAG);

    /**
     * This method is like `_.partial` except that partially applied arguments
     * are appended to those provided to the new function.
     *
     * The `_.partialRight.placeholder` value, which defaults to `_` in monolithic
     * builds, may be used as a placeholder for partially applied arguments.
     *
     * **Note:** This method does not set the "length" property of partially
     * applied functions.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to partially apply arguments to.
     * @param {...*} [partials] The arguments to be partially applied.
     * @returns {Function} Returns the new partially applied function.
     * @example
     *
     * var greet = function(greeting, name) {
     *   return greeting + ' ' + name;
     * };
     *
     * var greetFred = _.partialRight(greet, 'fred');
     * greetFred('hi');
     * // => 'hi fred'
     *
     * // using placeholders
     * var sayHelloTo = _.partialRight(greet, 'hello', _);
     * sayHelloTo('fred');
     * // => 'hello fred'
     */
    var partialRight = createPartial(PARTIAL_RIGHT_FLAG);

    /**
     * Creates a function that invokes `func` with arguments arranged according
     * to the specified indexes where the argument value at the first index is
     * provided as the first argument, the argument value at the second index is
     * provided as the second argument, and so on.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to rearrange arguments for.
     * @param {...(number|number[])} indexes The arranged argument indexes,
     *  specified as individual indexes or arrays of indexes.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var rearged = _.rearg(function(a, b, c) {
     *   return [a, b, c];
     * }, 2, 0, 1);
     *
     * rearged('b', 'c', 'a')
     * // => ['a', 'b', 'c']
     *
     * var map = _.rearg(_.map, [1, 0]);
     * map(function(n) {
     *   return n * 3;
     * }, [1, 2, 3]);
     * // => [3, 6, 9]
     */
    var rearg = restParam(function(func, indexes) {
      return createWrapper(func, REARG_FLAG, undefined, undefined, undefined, baseFlatten(indexes));
    });

    /**
     * Creates a function that invokes `func` with the `this` binding of the
     * created function and arguments from `start` and beyond provided as an array.
     *
     * **Note:** This method is based on the [rest parameter](https://developer.mozilla.org/Web/JavaScript/Reference/Functions/rest_parameters).
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to apply a rest parameter to.
     * @param {number} [start=func.length-1] The start position of the rest parameter.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var say = _.restParam(function(what, names) {
     *   return what + ' ' + _.initial(names).join(', ') +
     *     (_.size(names) > 1 ? ', & ' : '') + _.last(names);
     * });
     *
     * say('hello', 'fred', 'barney', 'pebbles');
     * // => 'hello fred, barney, & pebbles'
     */
    function restParam(func, start) {
      if (typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      start = nativeMax(start === undefined ? (func.length - 1) : (+start || 0), 0);
      return function() {
        var args = arguments,
            index = -1,
            length = nativeMax(args.length - start, 0),
            rest = Array(length);

        while (++index < length) {
          rest[index] = args[start + index];
        }
        switch (start) {
          case 0: return func.call(this, rest);
          case 1: return func.call(this, args[0], rest);
          case 2: return func.call(this, args[0], args[1], rest);
        }
        var otherArgs = Array(start + 1);
        index = -1;
        while (++index < start) {
          otherArgs[index] = args[index];
        }
        otherArgs[start] = rest;
        return func.apply(this, otherArgs);
      };
    }

    /**
     * Creates a function that invokes `func` with the `this` binding of the created
     * function and an array of arguments much like [`Function#apply`](https://es5.github.io/#x15.3.4.3).
     *
     * **Note:** This method is based on the [spread operator](https://developer.mozilla.org/Web/JavaScript/Reference/Operators/Spread_operator).
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to spread arguments over.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var say = _.spread(function(who, what) {
     *   return who + ' says ' + what;
     * });
     *
     * say(['fred', 'hello']);
     * // => 'fred says hello'
     *
     * // with a Promise
     * var numbers = Promise.all([
     *   Promise.resolve(40),
     *   Promise.resolve(36)
     * ]);
     *
     * numbers.then(_.spread(function(x, y) {
     *   return x + y;
     * }));
     * // => a Promise of 76
     */
    function spread(func) {
      if (typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      return function(array) {
        return func.apply(this, array);
      };
    }

    /**
     * Creates a throttled function that only invokes `func` at most once per
     * every `wait` milliseconds. The throttled function comes with a `cancel`
     * method to cancel delayed invocations. Provide an options object to indicate
     * that `func` should be invoked on the leading and/or trailing edge of the
     * `wait` timeout. Subsequent calls to the throttled function return the
     * result of the last `func` call.
     *
     * **Note:** If `leading` and `trailing` options are `true`, `func` is invoked
     * on the trailing edge of the timeout only if the the throttled function is
     * invoked more than once during the `wait` timeout.
     *
     * See [David Corbacho's article](http://drupalmotion.com/article/debounce-and-throttle-visual-explanation)
     * for details over the differences between `_.throttle` and `_.debounce`.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {Function} func The function to throttle.
     * @param {number} [wait=0] The number of milliseconds to throttle invocations to.
     * @param {Object} [options] The options object.
     * @param {boolean} [options.leading=true] Specify invoking on the leading
     *  edge of the timeout.
     * @param {boolean} [options.trailing=true] Specify invoking on the trailing
     *  edge of the timeout.
     * @returns {Function} Returns the new throttled function.
     * @example
     *
     * // avoid excessively updating the position while scrolling
     * jQuery(window).on('scroll', _.throttle(updatePosition, 100));
     *
     * // invoke `renewToken` when the click event is fired, but not more than once every 5 minutes
     * jQuery('.interactive').on('click', _.throttle(renewToken, 300000, {
     *   'trailing': false
     * }));
     *
     * // cancel a trailing throttled call
     * jQuery(window).on('popstate', throttled.cancel);
     */
    function throttle(func, wait, options) {
      var leading = true,
          trailing = true;

      if (typeof func != 'function') {
        throw new TypeError(FUNC_ERROR_TEXT);
      }
      if (options === false) {
        leading = false;
      } else if (isObject(options)) {
        leading = 'leading' in options ? !!options.leading : leading;
        trailing = 'trailing' in options ? !!options.trailing : trailing;
      }
      return debounce(func, wait, { 'leading': leading, 'maxWait': +wait, 'trailing': trailing });
    }

    /**
     * Creates a function that provides `value` to the wrapper function as its
     * first argument. Any additional arguments provided to the function are
     * appended to those provided to the wrapper function. The wrapper is invoked
     * with the `this` binding of the created function.
     *
     * @static
     * @memberOf _
     * @category Function
     * @param {*} value The value to wrap.
     * @param {Function} wrapper The wrapper function.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var p = _.wrap(_.escape, function(func, text) {
     *   return '<p>' + func(text) + '</p>';
     * });
     *
     * p('fred, barney, & pebbles');
     * // => '<p>fred, barney, &amp; pebbles</p>'
     */
    function wrap(value, wrapper) {
      wrapper = wrapper == null ? identity : wrapper;
      return createWrapper(wrapper, PARTIAL_FLAG, undefined, [value], []);
    }

    /*------------------------------------------------------------------------*/

    /**
     * Creates a clone of `value`. If `isDeep` is `true` nested objects are cloned,
     * otherwise they are assigned by reference. If `customizer` is provided it's
     * invoked to produce the cloned values. If `customizer` returns `undefined`
     * cloning is handled by the method instead. The `customizer` is bound to
     * `thisArg` and invoked with up to three argument; (value [, index|key, object]).
     *
     * **Note:** This method is loosely based on the
     * [structured clone algorithm](http://www.w3.org/TR/html5/infrastructure.html#internal-structured-cloning-algorithm).
     * The enumerable properties of `arguments` objects and objects created by
     * constructors other than `Object` are cloned to plain `Object` objects. An
     * empty object is returned for uncloneable values such as functions, DOM nodes,
     * Maps, Sets, and WeakMaps.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to clone.
     * @param {boolean} [isDeep] Specify a deep clone.
     * @param {Function} [customizer] The function to customize cloning values.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {*} Returns the cloned value.
     * @example
     *
     * var users = [
     *   { 'user': 'barney' },
     *   { 'user': 'fred' }
     * ];
     *
     * var shallow = _.clone(users);
     * shallow[0] === users[0];
     * // => true
     *
     * var deep = _.clone(users, true);
     * deep[0] === users[0];
     * // => false
     *
     * // using a customizer callback
     * var el = _.clone(document.body, function(value) {
     *   if (_.isElement(value)) {
     *     return value.cloneNode(false);
     *   }
     * });
     *
     * el === document.body
     * // => false
     * el.nodeName
     * // => BODY
     * el.childNodes.length;
     * // => 0
     */
    function clone(value, isDeep, customizer, thisArg) {
      if (isDeep && typeof isDeep != 'boolean' && isIterateeCall(value, isDeep, customizer)) {
        isDeep = false;
      }
      else if (typeof isDeep == 'function') {
        thisArg = customizer;
        customizer = isDeep;
        isDeep = false;
      }
      return typeof customizer == 'function'
        ? baseClone(value, isDeep, bindCallback(customizer, thisArg, 3))
        : baseClone(value, isDeep);
    }

    /**
     * Creates a deep clone of `value`. If `customizer` is provided it's invoked
     * to produce the cloned values. If `customizer` returns `undefined` cloning
     * is handled by the method instead. The `customizer` is bound to `thisArg`
     * and invoked with up to three argument; (value [, index|key, object]).
     *
     * **Note:** This method is loosely based on the
     * [structured clone algorithm](http://www.w3.org/TR/html5/infrastructure.html#internal-structured-cloning-algorithm).
     * The enumerable properties of `arguments` objects and objects created by
     * constructors other than `Object` are cloned to plain `Object` objects. An
     * empty object is returned for uncloneable values such as functions, DOM nodes,
     * Maps, Sets, and WeakMaps.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to deep clone.
     * @param {Function} [customizer] The function to customize cloning values.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {*} Returns the deep cloned value.
     * @example
     *
     * var users = [
     *   { 'user': 'barney' },
     *   { 'user': 'fred' }
     * ];
     *
     * var deep = _.cloneDeep(users);
     * deep[0] === users[0];
     * // => false
     *
     * // using a customizer callback
     * var el = _.cloneDeep(document.body, function(value) {
     *   if (_.isElement(value)) {
     *     return value.cloneNode(true);
     *   }
     * });
     *
     * el === document.body
     * // => false
     * el.nodeName
     * // => BODY
     * el.childNodes.length;
     * // => 20
     */
    function cloneDeep(value, customizer, thisArg) {
      return typeof customizer == 'function'
        ? baseClone(value, true, bindCallback(customizer, thisArg, 3))
        : baseClone(value, true);
    }

    /**
     * Checks if `value` is greater than `other`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @returns {boolean} Returns `true` if `value` is greater than `other`, else `false`.
     * @example
     *
     * _.gt(3, 1);
     * // => true
     *
     * _.gt(3, 3);
     * // => false
     *
     * _.gt(1, 3);
     * // => false
     */
    function gt(value, other) {
      return value > other;
    }

    /**
     * Checks if `value` is greater than or equal to `other`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @returns {boolean} Returns `true` if `value` is greater than or equal to `other`, else `false`.
     * @example
     *
     * _.gte(3, 1);
     * // => true
     *
     * _.gte(3, 3);
     * // => true
     *
     * _.gte(1, 3);
     * // => false
     */
    function gte(value, other) {
      return value >= other;
    }

    /**
     * Checks if `value` is classified as an `arguments` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isArguments(function() { return arguments; }());
     * // => true
     *
     * _.isArguments([1, 2, 3]);
     * // => false
     */
    function isArguments(value) {
      return isObjectLike(value) && isArrayLike(value) &&
        hasOwnProperty.call(value, 'callee') && !propertyIsEnumerable.call(value, 'callee');
    }

    /**
     * Checks if `value` is classified as an `Array` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isArray([1, 2, 3]);
     * // => true
     *
     * _.isArray(function() { return arguments; }());
     * // => false
     */
    var isArray = nativeIsArray || function(value) {
      return isObjectLike(value) && isLength(value.length) && objToString.call(value) == arrayTag;
    };

    /**
     * Checks if `value` is classified as a boolean primitive or object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isBoolean(false);
     * // => true
     *
     * _.isBoolean(null);
     * // => false
     */
    function isBoolean(value) {
      return value === true || value === false || (isObjectLike(value) && objToString.call(value) == boolTag);
    }

    /**
     * Checks if `value` is classified as a `Date` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isDate(new Date);
     * // => true
     *
     * _.isDate('Mon April 23 2012');
     * // => false
     */
    function isDate(value) {
      return isObjectLike(value) && objToString.call(value) == dateTag;
    }

    /**
     * Checks if `value` is a DOM element.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a DOM element, else `false`.
     * @example
     *
     * _.isElement(document.body);
     * // => true
     *
     * _.isElement('<body>');
     * // => false
     */
    function isElement(value) {
      return !!value && value.nodeType === 1 && isObjectLike(value) && !isPlainObject(value);
    }

    /**
     * Checks if `value` is empty. A value is considered empty unless it's an
     * `arguments` object, array, string, or jQuery-like collection with a length
     * greater than `0` or an object with own enumerable properties.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {Array|Object|string} value The value to inspect.
     * @returns {boolean} Returns `true` if `value` is empty, else `false`.
     * @example
     *
     * _.isEmpty(null);
     * // => true
     *
     * _.isEmpty(true);
     * // => true
     *
     * _.isEmpty(1);
     * // => true
     *
     * _.isEmpty([1, 2, 3]);
     * // => false
     *
     * _.isEmpty({ 'a': 1 });
     * // => false
     */
    function isEmpty(value) {
      if (value == null) {
        return true;
      }
      if (isArrayLike(value) && (isArray(value) || isString(value) || isArguments(value) ||
          (isObjectLike(value) && isFunction(value.splice)))) {
        return !value.length;
      }
      return !keys(value).length;
    }

    /**
     * Performs a deep comparison between two values to determine if they are
     * equivalent. If `customizer` is provided it's invoked to compare values.
     * If `customizer` returns `undefined` comparisons are handled by the method
     * instead. The `customizer` is bound to `thisArg` and invoked with up to
     * three arguments: (value, other [, index|key]).
     *
     * **Note:** This method supports comparing arrays, booleans, `Date` objects,
     * numbers, `Object` objects, regexes, and strings. Objects are compared by
     * their own, not inherited, enumerable properties. Functions and DOM nodes
     * are **not** supported. Provide a customizer function to extend support
     * for comparing other values.
     *
     * @static
     * @memberOf _
     * @alias eq
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @param {Function} [customizer] The function to customize value comparisons.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {boolean} Returns `true` if the values are equivalent, else `false`.
     * @example
     *
     * var object = { 'user': 'fred' };
     * var other = { 'user': 'fred' };
     *
     * object == other;
     * // => false
     *
     * _.isEqual(object, other);
     * // => true
     *
     * // using a customizer callback
     * var array = ['hello', 'goodbye'];
     * var other = ['hi', 'goodbye'];
     *
     * _.isEqual(array, other, function(value, other) {
     *   if (_.every([value, other], RegExp.prototype.test, /^h(?:i|ello)$/)) {
     *     return true;
     *   }
     * });
     * // => true
     */
    function isEqual(value, other, customizer, thisArg) {
      customizer = typeof customizer == 'function' ? bindCallback(customizer, thisArg, 3) : undefined;
      var result = customizer ? customizer(value, other) : undefined;
      return  result === undefined ? baseIsEqual(value, other, customizer) : !!result;
    }

    /**
     * Checks if `value` is an `Error`, `EvalError`, `RangeError`, `ReferenceError`,
     * `SyntaxError`, `TypeError`, or `URIError` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an error object, else `false`.
     * @example
     *
     * _.isError(new Error);
     * // => true
     *
     * _.isError(Error);
     * // => false
     */
    function isError(value) {
      return isObjectLike(value) && typeof value.message == 'string' && objToString.call(value) == errorTag;
    }

    /**
     * Checks if `value` is a finite primitive number.
     *
     * **Note:** This method is based on [`Number.isFinite`](http://ecma-international.org/ecma-262/6.0/#sec-number.isfinite).
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a finite number, else `false`.
     * @example
     *
     * _.isFinite(10);
     * // => true
     *
     * _.isFinite('10');
     * // => false
     *
     * _.isFinite(true);
     * // => false
     *
     * _.isFinite(Object(10));
     * // => false
     *
     * _.isFinite(Infinity);
     * // => false
     */
    function isFinite(value) {
      return typeof value == 'number' && nativeIsFinite(value);
    }

    /**
     * Checks if `value` is classified as a `Function` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isFunction(_);
     * // => true
     *
     * _.isFunction(/abc/);
     * // => false
     */
    function isFunction(value) {
      // The use of `Object#toString` avoids issues with the `typeof` operator
      // in older versions of Chrome and Safari which return 'function' for regexes
      // and Safari 8 which returns 'object' for typed array constructors.
      return isObject(value) && objToString.call(value) == funcTag;
    }

    /**
     * Checks if `value` is the [language type](https://es5.github.io/#x8) of `Object`.
     * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is an object, else `false`.
     * @example
     *
     * _.isObject({});
     * // => true
     *
     * _.isObject([1, 2, 3]);
     * // => true
     *
     * _.isObject(1);
     * // => false
     */
    function isObject(value) {
      // Avoid a V8 JIT bug in Chrome 19-20.
      // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
      var type = typeof value;
      return !!value && (type == 'object' || type == 'function');
    }

    /**
     * Performs a deep comparison between `object` and `source` to determine if
     * `object` contains equivalent property values. If `customizer` is provided
     * it's invoked to compare values. If `customizer` returns `undefined`
     * comparisons are handled by the method instead. The `customizer` is bound
     * to `thisArg` and invoked with three arguments: (value, other, index|key).
     *
     * **Note:** This method supports comparing properties of arrays, booleans,
     * `Date` objects, numbers, `Object` objects, regexes, and strings. Functions
     * and DOM nodes are **not** supported. Provide a customizer function to extend
     * support for comparing other values.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {Object} object The object to inspect.
     * @param {Object} source The object of property values to match.
     * @param {Function} [customizer] The function to customize value comparisons.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {boolean} Returns `true` if `object` is a match, else `false`.
     * @example
     *
     * var object = { 'user': 'fred', 'age': 40 };
     *
     * _.isMatch(object, { 'age': 40 });
     * // => true
     *
     * _.isMatch(object, { 'age': 36 });
     * // => false
     *
     * // using a customizer callback
     * var object = { 'greeting': 'hello' };
     * var source = { 'greeting': 'hi' };
     *
     * _.isMatch(object, source, function(value, other) {
     *   return _.every([value, other], RegExp.prototype.test, /^h(?:i|ello)$/) || undefined;
     * });
     * // => true
     */
    function isMatch(object, source, customizer, thisArg) {
      customizer = typeof customizer == 'function' ? bindCallback(customizer, thisArg, 3) : undefined;
      return baseIsMatch(object, getMatchData(source), customizer);
    }

    /**
     * Checks if `value` is `NaN`.
     *
     * **Note:** This method is not the same as [`isNaN`](https://es5.github.io/#x15.1.2.4)
     * which returns `true` for `undefined` and other non-numeric values.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is `NaN`, else `false`.
     * @example
     *
     * _.isNaN(NaN);
     * // => true
     *
     * _.isNaN(new Number(NaN));
     * // => true
     *
     * isNaN(undefined);
     * // => true
     *
     * _.isNaN(undefined);
     * // => false
     */
    function isNaN(value) {
      // An `NaN` primitive is the only value that is not equal to itself.
      // Perform the `toStringTag` check first to avoid errors with some host objects in IE.
      return isNumber(value) && value != +value;
    }

    /**
     * Checks if `value` is a native function.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a native function, else `false`.
     * @example
     *
     * _.isNative(Array.prototype.push);
     * // => true
     *
     * _.isNative(_);
     * // => false
     */
    function isNative(value) {
      if (value == null) {
        return false;
      }
      if (isFunction(value)) {
        return reIsNative.test(fnToString.call(value));
      }
      return isObjectLike(value) && (isHostObject(value) ? reIsNative : reIsHostCtor).test(value);
    }

    /**
     * Checks if `value` is `null`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is `null`, else `false`.
     * @example
     *
     * _.isNull(null);
     * // => true
     *
     * _.isNull(void 0);
     * // => false
     */
    function isNull(value) {
      return value === null;
    }

    /**
     * Checks if `value` is classified as a `Number` primitive or object.
     *
     * **Note:** To exclude `Infinity`, `-Infinity`, and `NaN`, which are classified
     * as numbers, use the `_.isFinite` method.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isNumber(8.4);
     * // => true
     *
     * _.isNumber(NaN);
     * // => true
     *
     * _.isNumber('8.4');
     * // => false
     */
    function isNumber(value) {
      return typeof value == 'number' || (isObjectLike(value) && objToString.call(value) == numberTag);
    }

    /**
     * Checks if `value` is a plain object, that is, an object created by the
     * `Object` constructor or one with a `[[Prototype]]` of `null`.
     *
     * **Note:** This method assumes objects created by the `Object` constructor
     * have no inherited enumerable properties.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is a plain object, else `false`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     * }
     *
     * _.isPlainObject(new Foo);
     * // => false
     *
     * _.isPlainObject([1, 2, 3]);
     * // => false
     *
     * _.isPlainObject({ 'x': 0, 'y': 0 });
     * // => true
     *
     * _.isPlainObject(Object.create(null));
     * // => true
     */
    function isPlainObject(value) {
      var Ctor;

      // Exit early for non `Object` objects.
      if (!(isObjectLike(value) && objToString.call(value) == objectTag && !isHostObject(value) && !isArguments(value)) ||
          (!hasOwnProperty.call(value, 'constructor') && (Ctor = value.constructor, typeof Ctor == 'function' && !(Ctor instanceof Ctor)))) {
        return false;
      }
      // IE < 9 iterates inherited properties before own properties. If the first
      // iterated property is an object's own property then there are no inherited
      // enumerable properties.
      var result;
      if (lodash.support.ownLast) {
        baseForIn(value, function(subValue, key, object) {
          result = hasOwnProperty.call(object, key);
          return false;
        });
        return result !== false;
      }
      // In most environments an object's own properties are iterated before
      // its inherited properties. If the last iterated property is an object's
      // own property then there are no inherited enumerable properties.
      baseForIn(value, function(subValue, key) {
        result = key;
      });
      return result === undefined || hasOwnProperty.call(value, result);
    }

    /**
     * Checks if `value` is classified as a `RegExp` object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isRegExp(/abc/);
     * // => true
     *
     * _.isRegExp('/abc/');
     * // => false
     */
    function isRegExp(value) {
      return isObject(value) && objToString.call(value) == regexpTag;
    }

    /**
     * Checks if `value` is classified as a `String` primitive or object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isString('abc');
     * // => true
     *
     * _.isString(1);
     * // => false
     */
    function isString(value) {
      return typeof value == 'string' || (isObjectLike(value) && objToString.call(value) == stringTag);
    }

    /**
     * Checks if `value` is classified as a typed array.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
     * @example
     *
     * _.isTypedArray(new Uint8Array);
     * // => true
     *
     * _.isTypedArray([]);
     * // => false
     */
    function isTypedArray(value) {
      return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[objToString.call(value)];
    }

    /**
     * Checks if `value` is `undefined`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to check.
     * @returns {boolean} Returns `true` if `value` is `undefined`, else `false`.
     * @example
     *
     * _.isUndefined(void 0);
     * // => true
     *
     * _.isUndefined(null);
     * // => false
     */
    function isUndefined(value) {
      return value === undefined;
    }

    /**
     * Checks if `value` is less than `other`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @returns {boolean} Returns `true` if `value` is less than `other`, else `false`.
     * @example
     *
     * _.lt(1, 3);
     * // => true
     *
     * _.lt(3, 3);
     * // => false
     *
     * _.lt(3, 1);
     * // => false
     */
    function lt(value, other) {
      return value < other;
    }

    /**
     * Checks if `value` is less than or equal to `other`.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to compare.
     * @param {*} other The other value to compare.
     * @returns {boolean} Returns `true` if `value` is less than or equal to `other`, else `false`.
     * @example
     *
     * _.lte(1, 3);
     * // => true
     *
     * _.lte(3, 3);
     * // => true
     *
     * _.lte(3, 1);
     * // => false
     */
    function lte(value, other) {
      return value <= other;
    }

    /**
     * Converts `value` to an array.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to convert.
     * @returns {Array} Returns the converted array.
     * @example
     *
     * (function() {
     *   return _.toArray(arguments).slice(1);
     * }(1, 2, 3));
     * // => [2, 3]
     */
    function toArray(value) {
      var length = value ? getLength(value) : 0;
      if (!isLength(length)) {
        return values(value);
      }
      if (!length) {
        return [];
      }
      return (lodash.support.unindexedChars && isString(value))
        ? value.split('')
        : arrayCopy(value);
    }

    /**
     * Converts `value` to a plain object flattening inherited enumerable
     * properties of `value` to own properties of the plain object.
     *
     * @static
     * @memberOf _
     * @category Lang
     * @param {*} value The value to convert.
     * @returns {Object} Returns the converted plain object.
     * @example
     *
     * function Foo() {
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.assign({ 'a': 1 }, new Foo);
     * // => { 'a': 1, 'b': 2 }
     *
     * _.assign({ 'a': 1 }, _.toPlainObject(new Foo));
     * // => { 'a': 1, 'b': 2, 'c': 3 }
     */
    function toPlainObject(value) {
      return baseCopy(value, keysIn(value));
    }

    /*------------------------------------------------------------------------*/

    /**
     * Recursively merges own enumerable properties of the source object(s), that
     * don't resolve to `undefined` into the destination object. Subsequent sources
     * overwrite property assignments of previous sources. If `customizer` is
     * provided it's invoked to produce the merged values of the destination and
     * source properties. If `customizer` returns `undefined` merging is handled
     * by the method instead. The `customizer` is bound to `thisArg` and invoked
     * with five arguments: (objectValue, sourceValue, key, object, source).
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The destination object.
     * @param {...Object} [sources] The source objects.
     * @param {Function} [customizer] The function to customize assigned values.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * var users = {
     *   'data': [{ 'user': 'barney' }, { 'user': 'fred' }]
     * };
     *
     * var ages = {
     *   'data': [{ 'age': 36 }, { 'age': 40 }]
     * };
     *
     * _.merge(users, ages);
     * // => { 'data': [{ 'user': 'barney', 'age': 36 }, { 'user': 'fred', 'age': 40 }] }
     *
     * // using a customizer callback
     * var object = {
     *   'fruits': ['apple'],
     *   'vegetables': ['beet']
     * };
     *
     * var other = {
     *   'fruits': ['banana'],
     *   'vegetables': ['carrot']
     * };
     *
     * _.merge(object, other, function(a, b) {
     *   if (_.isArray(a)) {
     *     return a.concat(b);
     *   }
     * });
     * // => { 'fruits': ['apple', 'banana'], 'vegetables': ['beet', 'carrot'] }
     */
    var merge = createAssigner(baseMerge);

    /**
     * Assigns own enumerable properties of source object(s) to the destination
     * object. Subsequent sources overwrite property assignments of previous sources.
     * If `customizer` is provided it's invoked to produce the assigned values.
     * The `customizer` is bound to `thisArg` and invoked with five arguments:
     * (objectValue, sourceValue, key, object, source).
     *
     * **Note:** This method mutates `object` and is based on
     * [`Object.assign`](http://ecma-international.org/ecma-262/6.0/#sec-object.assign).
     *
     * @static
     * @memberOf _
     * @alias extend
     * @category Object
     * @param {Object} object The destination object.
     * @param {...Object} [sources] The source objects.
     * @param {Function} [customizer] The function to customize assigned values.
     * @param {*} [thisArg] The `this` binding of `customizer`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * _.assign({ 'user': 'barney' }, { 'age': 40 }, { 'user': 'fred' });
     * // => { 'user': 'fred', 'age': 40 }
     *
     * // using a customizer callback
     * var defaults = _.partialRight(_.assign, function(value, other) {
     *   return _.isUndefined(value) ? other : value;
     * });
     *
     * defaults({ 'user': 'barney' }, { 'age': 36 }, { 'user': 'fred' });
     * // => { 'user': 'barney', 'age': 36 }
     */
    var assign = createAssigner(function(object, source, customizer) {
      return customizer
        ? assignWith(object, source, customizer)
        : baseAssign(object, source);
    });

    /**
     * Creates an object that inherits from the given `prototype` object. If a
     * `properties` object is provided its own enumerable properties are assigned
     * to the created object.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} prototype The object to inherit from.
     * @param {Object} [properties] The properties to assign to the object.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Object} Returns the new object.
     * @example
     *
     * function Shape() {
     *   this.x = 0;
     *   this.y = 0;
     * }
     *
     * function Circle() {
     *   Shape.call(this);
     * }
     *
     * Circle.prototype = _.create(Shape.prototype, {
     *   'constructor': Circle
     * });
     *
     * var circle = new Circle;
     * circle instanceof Circle;
     * // => true
     *
     * circle instanceof Shape;
     * // => true
     */
    function create(prototype, properties, guard) {
      var result = baseCreate(prototype);
      if (guard && isIterateeCall(prototype, properties, guard)) {
        properties = undefined;
      }
      return properties ? baseAssign(result, properties) : result;
    }

    /**
     * Assigns own enumerable properties of source object(s) to the destination
     * object for all destination properties that resolve to `undefined`. Once a
     * property is set, additional values of the same property are ignored.
     *
     * **Note:** This method mutates `object`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The destination object.
     * @param {...Object} [sources] The source objects.
     * @returns {Object} Returns `object`.
     * @example
     *
     * _.defaults({ 'user': 'barney' }, { 'age': 36 }, { 'user': 'fred' });
     * // => { 'user': 'barney', 'age': 36 }
     */
    var defaults = createDefaults(assign, assignDefaults);

    /**
     * This method is like `_.defaults` except that it recursively assigns
     * default properties.
     *
     * **Note:** This method mutates `object`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The destination object.
     * @param {...Object} [sources] The source objects.
     * @returns {Object} Returns `object`.
     * @example
     *
     * _.defaultsDeep({ 'user': { 'name': 'barney' } }, { 'user': { 'name': 'fred', 'age': 36 } });
     * // => { 'user': { 'name': 'barney', 'age': 36 } }
     *
     */
    var defaultsDeep = createDefaults(merge, mergeDefaults);

    /**
     * This method is like `_.find` except that it returns the key of the first
     * element `predicate` returns truthy for instead of the element itself.
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {string|undefined} Returns the key of the matched element, else `undefined`.
     * @example
     *
     * var users = {
     *   'barney':  { 'age': 36, 'active': true },
     *   'fred':    { 'age': 40, 'active': false },
     *   'pebbles': { 'age': 1,  'active': true }
     * };
     *
     * _.findKey(users, function(chr) {
     *   return chr.age < 40;
     * });
     * // => 'barney' (iteration order is not guaranteed)
     *
     * // using the `_.matches` callback shorthand
     * _.findKey(users, { 'age': 1, 'active': true });
     * // => 'pebbles'
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.findKey(users, 'active', false);
     * // => 'fred'
     *
     * // using the `_.property` callback shorthand
     * _.findKey(users, 'active');
     * // => 'barney'
     */
    var findKey = createFindKey(baseForOwn);

    /**
     * This method is like `_.findKey` except that it iterates over elements of
     * a collection in the opposite order.
     *
     * If a property name is provided for `predicate` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `predicate` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to search.
     * @param {Function|Object|string} [predicate=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {string|undefined} Returns the key of the matched element, else `undefined`.
     * @example
     *
     * var users = {
     *   'barney':  { 'age': 36, 'active': true },
     *   'fred':    { 'age': 40, 'active': false },
     *   'pebbles': { 'age': 1,  'active': true }
     * };
     *
     * _.findLastKey(users, function(chr) {
     *   return chr.age < 40;
     * });
     * // => returns `pebbles` assuming `_.findKey` returns `barney`
     *
     * // using the `_.matches` callback shorthand
     * _.findLastKey(users, { 'age': 36, 'active': true });
     * // => 'barney'
     *
     * // using the `_.matchesProperty` callback shorthand
     * _.findLastKey(users, 'active', false);
     * // => 'fred'
     *
     * // using the `_.property` callback shorthand
     * _.findLastKey(users, 'active');
     * // => 'pebbles'
     */
    var findLastKey = createFindKey(baseForOwnRight);

    /**
     * Iterates over own and inherited enumerable properties of an object invoking
     * `iteratee` for each property. The `iteratee` is bound to `thisArg` and invoked
     * with three arguments: (value, key, object). Iteratee functions may exit
     * iteration early by explicitly returning `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.forIn(new Foo, function(value, key) {
     *   console.log(key);
     * });
     * // => logs 'a', 'b', and 'c' (iteration order is not guaranteed)
     */
    var forIn = createForIn(baseFor);

    /**
     * This method is like `_.forIn` except that it iterates over properties of
     * `object` in the opposite order.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.forInRight(new Foo, function(value, key) {
     *   console.log(key);
     * });
     * // => logs 'c', 'b', and 'a' assuming `_.forIn ` logs 'a', 'b', and 'c'
     */
    var forInRight = createForIn(baseForRight);

    /**
     * Iterates over own enumerable properties of an object invoking `iteratee`
     * for each property. The `iteratee` is bound to `thisArg` and invoked with
     * three arguments: (value, key, object). Iteratee functions may exit iteration
     * early by explicitly returning `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.forOwn(new Foo, function(value, key) {
     *   console.log(key);
     * });
     * // => logs 'a' and 'b' (iteration order is not guaranteed)
     */
    var forOwn = createForOwn(baseForOwn);

    /**
     * This method is like `_.forOwn` except that it iterates over properties of
     * `object` in the opposite order.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns `object`.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.forOwnRight(new Foo, function(value, key) {
     *   console.log(key);
     * });
     * // => logs 'b' and 'a' assuming `_.forOwn` logs 'a' and 'b'
     */
    var forOwnRight = createForOwn(baseForOwnRight);

    /**
     * Creates an array of function property names from all enumerable properties,
     * own and inherited, of `object`.
     *
     * @static
     * @memberOf _
     * @alias methods
     * @category Object
     * @param {Object} object The object to inspect.
     * @returns {Array} Returns the new array of property names.
     * @example
     *
     * _.functions(_);
     * // => ['after', 'ary', 'assign', ...]
     */
    function functions(object) {
      return baseFunctions(object, keysIn(object));
    }

    /**
     * Gets the property value at `path` of `object`. If the resolved value is
     * `undefined` the `defaultValue` is used in its place.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @param {Array|string} path The path of the property to get.
     * @param {*} [defaultValue] The value returned if the resolved value is `undefined`.
     * @returns {*} Returns the resolved value.
     * @example
     *
     * var object = { 'a': [{ 'b': { 'c': 3 } }] };
     *
     * _.get(object, 'a[0].b.c');
     * // => 3
     *
     * _.get(object, ['a', '0', 'b', 'c']);
     * // => 3
     *
     * _.get(object, 'a.b.c', 'default');
     * // => 'default'
     */
    function get(object, path, defaultValue) {
      var result = object == null ? undefined : baseGet(object, toPath(path), (path + ''));
      return result === undefined ? defaultValue : result;
    }

    /**
     * Checks if `path` is a direct property.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @param {Array|string} path The path to check.
     * @returns {boolean} Returns `true` if `path` is a direct property, else `false`.
     * @example
     *
     * var object = { 'a': { 'b': { 'c': 3 } } };
     *
     * _.has(object, 'a');
     * // => true
     *
     * _.has(object, 'a.b.c');
     * // => true
     *
     * _.has(object, ['a', 'b', 'c']);
     * // => true
     */
    function has(object, path) {
      if (object == null) {
        return false;
      }
      var result = hasOwnProperty.call(object, path);
      if (!result && !isKey(path)) {
        path = toPath(path);
        object = path.length == 1 ? object : baseGet(object, baseSlice(path, 0, -1));
        if (object == null) {
          return false;
        }
        path = last(path);
        result = hasOwnProperty.call(object, path);
      }
      return result || (isLength(object.length) && isIndex(path, object.length) &&
        (isArray(object) || isArguments(object) || isString(object)));
    }

    /**
     * Creates an object composed of the inverted keys and values of `object`.
     * If `object` contains duplicate values, subsequent values overwrite property
     * assignments of previous values unless `multiValue` is `true`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to invert.
     * @param {boolean} [multiValue] Allow multiple values per key.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Object} Returns the new inverted object.
     * @example
     *
     * var object = { 'a': 1, 'b': 2, 'c': 1 };
     *
     * _.invert(object);
     * // => { '1': 'c', '2': 'b' }
     *
     * // with `multiValue`
     * _.invert(object, true);
     * // => { '1': ['a', 'c'], '2': ['b'] }
     */
    function invert(object, multiValue, guard) {
      if (guard && isIterateeCall(object, multiValue, guard)) {
        multiValue = undefined;
      }
      var index = -1,
          props = keys(object),
          length = props.length,
          result = {};

      while (++index < length) {
        var key = props[index],
            value = object[key];

        if (multiValue) {
          if (hasOwnProperty.call(result, value)) {
            result[value].push(key);
          } else {
            result[value] = [key];
          }
        }
        else {
          result[value] = key;
        }
      }
      return result;
    }

    /**
     * Creates an array of the own enumerable property names of `object`.
     *
     * **Note:** Non-object values are coerced to objects. See the
     * [ES spec](http://ecma-international.org/ecma-262/6.0/#sec-object.keys)
     * for more details.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.keys(new Foo);
     * // => ['a', 'b'] (iteration order is not guaranteed)
     *
     * _.keys('hi');
     * // => ['0', '1']
     */
    var keys = !nativeKeys ? shimKeys : function(object) {
      var Ctor = object == null ? undefined : object.constructor;
      if ((typeof Ctor == 'function' && Ctor.prototype === object) ||
          (typeof object == 'function' ? lodash.support.enumPrototypes : isArrayLike(object))) {
        return shimKeys(object);
      }
      return isObject(object) ? nativeKeys(object) : [];
    };

    /**
     * Creates an array of the own and inherited enumerable property names of `object`.
     *
     * **Note:** Non-object values are coerced to objects.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property names.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.keysIn(new Foo);
     * // => ['a', 'b', 'c'] (iteration order is not guaranteed)
     */
    function keysIn(object) {
      if (object == null) {
        return [];
      }
      if (!isObject(object)) {
        object = Object(object);
      }
      var length = object.length,
          support = lodash.support;

      length = (length && isLength(length) &&
        (isArray(object) || isArguments(object) || isString(object)) && length) || 0;

      var Ctor = object.constructor,
          index = -1,
          proto = (isFunction(Ctor) && Ctor.prototype) || objectProto,
          isProto = proto === object,
          result = Array(length),
          skipIndexes = length > 0,
          skipErrorProps = support.enumErrorProps && (object === errorProto || object instanceof Error),
          skipProto = support.enumPrototypes && isFunction(object);

      while (++index < length) {
        result[index] = (index + '');
      }
      // lodash skips the `constructor` property when it infers it's iterating
      // over a `prototype` object because IE < 9 can't set the `[[Enumerable]]`
      // attribute of an existing property and the `constructor` property of a
      // prototype defaults to non-enumerable.
      for (var key in object) {
        if (!(skipProto && key == 'prototype') &&
            !(skipErrorProps && (key == 'message' || key == 'name')) &&
            !(skipIndexes && isIndex(key, length)) &&
            !(key == 'constructor' && (isProto || !hasOwnProperty.call(object, key)))) {
          result.push(key);
        }
      }
      if (support.nonEnumShadows && object !== objectProto) {
        var tag = object === stringProto ? stringTag : (object === errorProto ? errorTag : objToString.call(object)),
            nonEnums = nonEnumProps[tag] || nonEnumProps[objectTag];

        if (tag == objectTag) {
          proto = objectProto;
        }
        length = shadowProps.length;
        while (length--) {
          key = shadowProps[length];
          var nonEnum = nonEnums[key];
          if (!(isProto && nonEnum) &&
              (nonEnum ? hasOwnProperty.call(object, key) : object[key] !== proto[key])) {
            result.push(key);
          }
        }
      }
      return result;
    }

    /**
     * The opposite of `_.mapValues`; this method creates an object with the
     * same values as `object` and keys generated by running each own enumerable
     * property of `object` through `iteratee`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns the new mapped object.
     * @example
     *
     * _.mapKeys({ 'a': 1, 'b': 2 }, function(value, key) {
     *   return key + value;
     * });
     * // => { 'a1': 1, 'b2': 2 }
     */
    var mapKeys = createObjectMapper(true);

    /**
     * Creates an object with the same keys as `object` and values generated by
     * running each own enumerable property of `object` through `iteratee`. The
     * iteratee function is bound to `thisArg` and invoked with three arguments:
     * (value, key, object).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to iterate over.
     * @param {Function|Object|string} [iteratee=_.identity] The function invoked
     *  per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Object} Returns the new mapped object.
     * @example
     *
     * _.mapValues({ 'a': 1, 'b': 2 }, function(n) {
     *   return n * 3;
     * });
     * // => { 'a': 3, 'b': 6 }
     *
     * var users = {
     *   'fred':    { 'user': 'fred',    'age': 40 },
     *   'pebbles': { 'user': 'pebbles', 'age': 1 }
     * };
     *
     * // using the `_.property` callback shorthand
     * _.mapValues(users, 'age');
     * // => { 'fred': 40, 'pebbles': 1 } (iteration order is not guaranteed)
     */
    var mapValues = createObjectMapper();

    /**
     * The opposite of `_.pick`; this method creates an object composed of the
     * own and inherited enumerable properties of `object` that are not omitted.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The source object.
     * @param {Function|...(string|string[])} [predicate] The function invoked per
     *  iteration or property names to omit, specified as individual property
     *  names or arrays of property names.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Object} Returns the new object.
     * @example
     *
     * var object = { 'user': 'fred', 'age': 40 };
     *
     * _.omit(object, 'age');
     * // => { 'user': 'fred' }
     *
     * _.omit(object, _.isNumber);
     * // => { 'user': 'fred' }
     */
    var omit = restParam(function(object, props) {
      if (object == null) {
        return {};
      }
      if (typeof props[0] != 'function') {
        var props = arrayMap(baseFlatten(props), String);
        return pickByArray(object, baseDifference(keysIn(object), props));
      }
      var predicate = bindCallback(props[0], props[1], 3);
      return pickByCallback(object, function(value, key, object) {
        return !predicate(value, key, object);
      });
    });

    /**
     * Creates a two dimensional array of the key-value pairs for `object`,
     * e.g. `[[key1, value1], [key2, value2]]`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the new array of key-value pairs.
     * @example
     *
     * _.pairs({ 'barney': 36, 'fred': 40 });
     * // => [['barney', 36], ['fred', 40]] (iteration order is not guaranteed)
     */
    function pairs(object) {
      object = toObject(object);

      var index = -1,
          props = keys(object),
          length = props.length,
          result = Array(length);

      while (++index < length) {
        var key = props[index];
        result[index] = [key, object[key]];
      }
      return result;
    }

    /**
     * Creates an object composed of the picked `object` properties. Property
     * names may be specified as individual arguments or as arrays of property
     * names. If `predicate` is provided it's invoked for each property of `object`
     * picking the properties `predicate` returns truthy for. The predicate is
     * bound to `thisArg` and invoked with three arguments: (value, key, object).
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The source object.
     * @param {Function|...(string|string[])} [predicate] The function invoked per
     *  iteration or property names to pick, specified as individual property
     *  names or arrays of property names.
     * @param {*} [thisArg] The `this` binding of `predicate`.
     * @returns {Object} Returns the new object.
     * @example
     *
     * var object = { 'user': 'fred', 'age': 40 };
     *
     * _.pick(object, 'user');
     * // => { 'user': 'fred' }
     *
     * _.pick(object, _.isString);
     * // => { 'user': 'fred' }
     */
    var pick = restParam(function(object, props) {
      if (object == null) {
        return {};
      }
      return typeof props[0] == 'function'
        ? pickByCallback(object, bindCallback(props[0], props[1], 3))
        : pickByArray(object, baseFlatten(props));
    });

    /**
     * This method is like `_.get` except that if the resolved value is a function
     * it's invoked with the `this` binding of its parent object and its result
     * is returned.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @param {Array|string} path The path of the property to resolve.
     * @param {*} [defaultValue] The value returned if the resolved value is `undefined`.
     * @returns {*} Returns the resolved value.
     * @example
     *
     * var object = { 'a': [{ 'b': { 'c1': 3, 'c2': _.constant(4) } }] };
     *
     * _.result(object, 'a[0].b.c1');
     * // => 3
     *
     * _.result(object, 'a[0].b.c2');
     * // => 4
     *
     * _.result(object, 'a.b.c', 'default');
     * // => 'default'
     *
     * _.result(object, 'a.b.c', _.constant('default'));
     * // => 'default'
     */
    function result(object, path, defaultValue) {
      var result = object == null ? undefined : toObject(object)[path];
      if (result === undefined) {
        if (object != null && !isKey(path, object)) {
          path = toPath(path);
          object = path.length == 1 ? object : baseGet(object, baseSlice(path, 0, -1));
          result = object == null ? undefined : toObject(object)[last(path)];
        }
        result = result === undefined ? defaultValue : result;
      }
      return isFunction(result) ? result.call(object) : result;
    }

    /**
     * Sets the property value of `path` on `object`. If a portion of `path`
     * does not exist it's created.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to augment.
     * @param {Array|string} path The path of the property to set.
     * @param {*} value The value to set.
     * @returns {Object} Returns `object`.
     * @example
     *
     * var object = { 'a': [{ 'b': { 'c': 3 } }] };
     *
     * _.set(object, 'a[0].b.c', 4);
     * console.log(object.a[0].b.c);
     * // => 4
     *
     * _.set(object, 'x[0].y.z', 5);
     * console.log(object.x[0].y.z);
     * // => 5
     */
    function set(object, path, value) {
      if (object == null) {
        return object;
      }
      var pathKey = (path + '');
      path = (object[pathKey] != null || isKey(path, object)) ? [pathKey] : toPath(path);

      var index = -1,
          length = path.length,
          lastIndex = length - 1,
          nested = object;

      while (nested != null && ++index < length) {
        var key = path[index];
        if (isObject(nested)) {
          if (index == lastIndex) {
            nested[key] = value;
          } else if (nested[key] == null) {
            nested[key] = isIndex(path[index + 1]) ? [] : {};
          }
        }
        nested = nested[key];
      }
      return object;
    }

    /**
     * An alternative to `_.reduce`; this method transforms `object` to a new
     * `accumulator` object which is the result of running each of its own enumerable
     * properties through `iteratee`, with each invocation potentially mutating
     * the `accumulator` object. The `iteratee` is bound to `thisArg` and invoked
     * with four arguments: (accumulator, value, key, object). Iteratee functions
     * may exit iteration early by explicitly returning `false`.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Array|Object} object The object to iterate over.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [accumulator] The custom accumulator value.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {*} Returns the accumulated value.
     * @example
     *
     * _.transform([2, 3, 4], function(result, n) {
     *   result.push(n *= n);
     *   return n % 2 == 0;
     * });
     * // => [4, 9]
     *
     * _.transform({ 'a': 1, 'b': 2 }, function(result, n, key) {
     *   result[key] = n * 3;
     * });
     * // => { 'a': 3, 'b': 6 }
     */
    function transform(object, iteratee, accumulator, thisArg) {
      var isArr = isArray(object) || isTypedArray(object);
      iteratee = getCallback(iteratee, thisArg, 4);

      if (accumulator == null) {
        if (isArr || isObject(object)) {
          var Ctor = object.constructor;
          if (isArr) {
            accumulator = isArray(object) ? new Ctor : [];
          } else {
            accumulator = baseCreate(isFunction(Ctor) ? Ctor.prototype : undefined);
          }
        } else {
          accumulator = {};
        }
      }
      (isArr ? arrayEach : baseForOwn)(object, function(value, index, object) {
        return iteratee(accumulator, value, index, object);
      });
      return accumulator;
    }

    /**
     * Creates an array of the own enumerable property values of `object`.
     *
     * **Note:** Non-object values are coerced to objects.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property values.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.values(new Foo);
     * // => [1, 2] (iteration order is not guaranteed)
     *
     * _.values('hi');
     * // => ['h', 'i']
     */
    function values(object) {
      return baseValues(object, keys(object));
    }

    /**
     * Creates an array of the own and inherited enumerable property values
     * of `object`.
     *
     * **Note:** Non-object values are coerced to objects.
     *
     * @static
     * @memberOf _
     * @category Object
     * @param {Object} object The object to query.
     * @returns {Array} Returns the array of property values.
     * @example
     *
     * function Foo() {
     *   this.a = 1;
     *   this.b = 2;
     * }
     *
     * Foo.prototype.c = 3;
     *
     * _.valuesIn(new Foo);
     * // => [1, 2, 3] (iteration order is not guaranteed)
     */
    function valuesIn(object) {
      return baseValues(object, keysIn(object));
    }

    /*------------------------------------------------------------------------*/

    /**
     * Checks if `n` is between `start` and up to but not including, `end`. If
     * `end` is not specified it's set to `start` with `start` then set to `0`.
     *
     * @static
     * @memberOf _
     * @category Number
     * @param {number} n The number to check.
     * @param {number} [start=0] The start of the range.
     * @param {number} end The end of the range.
     * @returns {boolean} Returns `true` if `n` is in the range, else `false`.
     * @example
     *
     * _.inRange(3, 2, 4);
     * // => true
     *
     * _.inRange(4, 8);
     * // => true
     *
     * _.inRange(4, 2);
     * // => false
     *
     * _.inRange(2, 2);
     * // => false
     *
     * _.inRange(1.2, 2);
     * // => true
     *
     * _.inRange(5.2, 4);
     * // => false
     */
    function inRange(value, start, end) {
      start = +start || 0;
      if (end === undefined) {
        end = start;
        start = 0;
      } else {
        end = +end || 0;
      }
      return value >= nativeMin(start, end) && value < nativeMax(start, end);
    }

    /**
     * Produces a random number between `min` and `max` (inclusive). If only one
     * argument is provided a number between `0` and the given number is returned.
     * If `floating` is `true`, or either `min` or `max` are floats, a floating-point
     * number is returned instead of an integer.
     *
     * @static
     * @memberOf _
     * @category Number
     * @param {number} [min=0] The minimum possible value.
     * @param {number} [max=1] The maximum possible value.
     * @param {boolean} [floating] Specify returning a floating-point number.
     * @returns {number} Returns the random number.
     * @example
     *
     * _.random(0, 5);
     * // => an integer between 0 and 5
     *
     * _.random(5);
     * // => also an integer between 0 and 5
     *
     * _.random(5, true);
     * // => a floating-point number between 0 and 5
     *
     * _.random(1.2, 5.2);
     * // => a floating-point number between 1.2 and 5.2
     */
    function random(min, max, floating) {
      if (floating && isIterateeCall(min, max, floating)) {
        max = floating = undefined;
      }
      var noMin = min == null,
          noMax = max == null;

      if (floating == null) {
        if (noMax && typeof min == 'boolean') {
          floating = min;
          min = 1;
        }
        else if (typeof max == 'boolean') {
          floating = max;
          noMax = true;
        }
      }
      if (noMin && noMax) {
        max = 1;
        noMax = false;
      }
      min = +min || 0;
      if (noMax) {
        max = min;
        min = 0;
      } else {
        max = +max || 0;
      }
      if (floating || min % 1 || max % 1) {
        var rand = nativeRandom();
        return nativeMin(min + (rand * (max - min + parseFloat('1e-' + ((rand + '').length - 1)))), max);
      }
      return baseRandom(min, max);
    }

    /*------------------------------------------------------------------------*/

    /**
     * Converts `string` to [camel case](https://en.wikipedia.org/wiki/CamelCase).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to convert.
     * @returns {string} Returns the camel cased string.
     * @example
     *
     * _.camelCase('Foo Bar');
     * // => 'fooBar'
     *
     * _.camelCase('--foo-bar');
     * // => 'fooBar'
     *
     * _.camelCase('__foo_bar__');
     * // => 'fooBar'
     */
    var camelCase = createCompounder(function(result, word, index) {
      word = word.toLowerCase();
      return result + (index ? (word.charAt(0).toUpperCase() + word.slice(1)) : word);
    });

    /**
     * Capitalizes the first character of `string`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to capitalize.
     * @returns {string} Returns the capitalized string.
     * @example
     *
     * _.capitalize('fred');
     * // => 'Fred'
     */
    function capitalize(string) {
      string = baseToString(string);
      return string && (string.charAt(0).toUpperCase() + string.slice(1));
    }

    /**
     * Deburrs `string` by converting [latin-1 supplementary letters](https://en.wikipedia.org/wiki/Latin-1_Supplement_(Unicode_block)#Character_table)
     * to basic latin letters and removing [combining diacritical marks](https://en.wikipedia.org/wiki/Combining_Diacritical_Marks).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to deburr.
     * @returns {string} Returns the deburred string.
     * @example
     *
     * _.deburr('déjà vu');
     * // => 'deja vu'
     */
    function deburr(string) {
      string = baseToString(string);
      return string && string.replace(reLatin1, deburrLetter).replace(reComboMark, '');
    }

    /**
     * Checks if `string` ends with the given target string.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to search.
     * @param {string} [target] The string to search for.
     * @param {number} [position=string.length] The position to search from.
     * @returns {boolean} Returns `true` if `string` ends with `target`, else `false`.
     * @example
     *
     * _.endsWith('abc', 'c');
     * // => true
     *
     * _.endsWith('abc', 'b');
     * // => false
     *
     * _.endsWith('abc', 'b', 2);
     * // => true
     */
    function endsWith(string, target, position) {
      string = baseToString(string);
      target = (target + '');

      var length = string.length;
      position = position === undefined
        ? length
        : nativeMin(position < 0 ? 0 : (+position || 0), length);

      position -= target.length;
      return position >= 0 && string.indexOf(target, position) == position;
    }

    /**
     * Converts the characters "&", "<", ">", '"', "'", and "\`", in `string` to
     * their corresponding HTML entities.
     *
     * **Note:** No other characters are escaped. To escape additional characters
     * use a third-party library like [_he_](https://mths.be/he).
     *
     * Though the ">" character is escaped for symmetry, characters like
     * ">" and "/" don't need escaping in HTML and have no special meaning
     * unless they're part of a tag or unquoted attribute value.
     * See [Mathias Bynens's article](https://mathiasbynens.be/notes/ambiguous-ampersands)
     * (under "semi-related fun fact") for more details.
     *
     * Backticks are escaped because in Internet Explorer < 9, they can break out
     * of attribute values or HTML comments. See [#59](https://html5sec.org/#59),
     * [#102](https://html5sec.org/#102), [#108](https://html5sec.org/#108), and
     * [#133](https://html5sec.org/#133) of the [HTML5 Security Cheatsheet](https://html5sec.org/)
     * for more details.
     *
     * When working with HTML you should always [quote attribute values](http://wonko.com/post/html-escaping)
     * to reduce XSS vectors.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to escape.
     * @returns {string} Returns the escaped string.
     * @example
     *
     * _.escape('fred, barney, & pebbles');
     * // => 'fred, barney, &amp; pebbles'
     */
    function escape(string) {
      // Reset `lastIndex` because in IE < 9 `String#replace` does not.
      string = baseToString(string);
      return (string && reHasUnescapedHtml.test(string))
        ? string.replace(reUnescapedHtml, escapeHtmlChar)
        : string;
    }

    /**
     * Escapes the `RegExp` special characters "\", "/", "^", "$", ".", "|", "?",
     * "*", "+", "(", ")", "[", "]", "{" and "}" in `string`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to escape.
     * @returns {string} Returns the escaped string.
     * @example
     *
     * _.escapeRegExp('[lodash](https://lodash.com/)');
     * // => '\[lodash\]\(https:\/\/lodash\.com\/\)'
     */
    function escapeRegExp(string) {
      string = baseToString(string);
      return (string && reHasRegExpChars.test(string))
        ? string.replace(reRegExpChars, escapeRegExpChar)
        : (string || '(?:)');
    }

    /**
     * Converts `string` to [kebab case](https://en.wikipedia.org/wiki/Letter_case#Special_case_styles).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to convert.
     * @returns {string} Returns the kebab cased string.
     * @example
     *
     * _.kebabCase('Foo Bar');
     * // => 'foo-bar'
     *
     * _.kebabCase('fooBar');
     * // => 'foo-bar'
     *
     * _.kebabCase('__foo_bar__');
     * // => 'foo-bar'
     */
    var kebabCase = createCompounder(function(result, word, index) {
      return result + (index ? '-' : '') + word.toLowerCase();
    });

    /**
     * Pads `string` on the left and right sides if it's shorter than `length`.
     * Padding characters are truncated if they can't be evenly divided by `length`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to pad.
     * @param {number} [length=0] The padding length.
     * @param {string} [chars=' '] The string used as padding.
     * @returns {string} Returns the padded string.
     * @example
     *
     * _.pad('abc', 8);
     * // => '  abc   '
     *
     * _.pad('abc', 8, '_-');
     * // => '_-abc_-_'
     *
     * _.pad('abc', 3);
     * // => 'abc'
     */
    function pad(string, length, chars) {
      string = baseToString(string);
      length = +length;

      var strLength = string.length;
      if (strLength >= length || !nativeIsFinite(length)) {
        return string;
      }
      var mid = (length - strLength) / 2,
          leftLength = nativeFloor(mid),
          rightLength = nativeCeil(mid);

      chars = createPadding('', rightLength, chars);
      return chars.slice(0, leftLength) + string + chars;
    }

    /**
     * Pads `string` on the left side if it's shorter than `length`. Padding
     * characters are truncated if they exceed `length`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to pad.
     * @param {number} [length=0] The padding length.
     * @param {string} [chars=' '] The string used as padding.
     * @returns {string} Returns the padded string.
     * @example
     *
     * _.padLeft('abc', 6);
     * // => '   abc'
     *
     * _.padLeft('abc', 6, '_-');
     * // => '_-_abc'
     *
     * _.padLeft('abc', 3);
     * // => 'abc'
     */
    var padLeft = createPadDir();

    /**
     * Pads `string` on the right side if it's shorter than `length`. Padding
     * characters are truncated if they exceed `length`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to pad.
     * @param {number} [length=0] The padding length.
     * @param {string} [chars=' '] The string used as padding.
     * @returns {string} Returns the padded string.
     * @example
     *
     * _.padRight('abc', 6);
     * // => 'abc   '
     *
     * _.padRight('abc', 6, '_-');
     * // => 'abc_-_'
     *
     * _.padRight('abc', 3);
     * // => 'abc'
     */
    var padRight = createPadDir(true);

    /**
     * Converts `string` to an integer of the specified radix. If `radix` is
     * `undefined` or `0`, a `radix` of `10` is used unless `value` is a hexadecimal,
     * in which case a `radix` of `16` is used.
     *
     * **Note:** This method aligns with the [ES5 implementation](https://es5.github.io/#E)
     * of `parseInt`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} string The string to convert.
     * @param {number} [radix] The radix to interpret `value` by.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {number} Returns the converted integer.
     * @example
     *
     * _.parseInt('08');
     * // => 8
     *
     * _.map(['6', '08', '10'], _.parseInt);
     * // => [6, 8, 10]
     */
    function parseInt(string, radix, guard) {
      // Firefox < 21 and Opera < 15 follow ES3 for `parseInt`.
      // Chrome fails to trim leading <BOM> whitespace characters.
      // See https://code.google.com/p/v8/issues/detail?id=3109 for more details.
      if (guard ? isIterateeCall(string, radix, guard) : radix == null) {
        radix = 0;
      } else if (radix) {
        radix = +radix;
      }
      string = trim(string);
      return nativeParseInt(string, radix || (reHasHexPrefix.test(string) ? 16 : 10));
    }

    /**
     * Repeats the given string `n` times.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to repeat.
     * @param {number} [n=0] The number of times to repeat the string.
     * @returns {string} Returns the repeated string.
     * @example
     *
     * _.repeat('*', 3);
     * // => '***'
     *
     * _.repeat('abc', 2);
     * // => 'abcabc'
     *
     * _.repeat('abc', 0);
     * // => ''
     */
    function repeat(string, n) {
      var result = '';
      string = baseToString(string);
      n = +n;
      if (n < 1 || !string || !nativeIsFinite(n)) {
        return result;
      }
      // Leverage the exponentiation by squaring algorithm for a faster repeat.
      // See https://en.wikipedia.org/wiki/Exponentiation_by_squaring for more details.
      do {
        if (n % 2) {
          result += string;
        }
        n = nativeFloor(n / 2);
        string += string;
      } while (n);

      return result;
    }

    /**
     * Converts `string` to [snake case](https://en.wikipedia.org/wiki/Snake_case).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to convert.
     * @returns {string} Returns the snake cased string.
     * @example
     *
     * _.snakeCase('Foo Bar');
     * // => 'foo_bar'
     *
     * _.snakeCase('fooBar');
     * // => 'foo_bar'
     *
     * _.snakeCase('--foo-bar');
     * // => 'foo_bar'
     */
    var snakeCase = createCompounder(function(result, word, index) {
      return result + (index ? '_' : '') + word.toLowerCase();
    });

    /**
     * Converts `string` to [start case](https://en.wikipedia.org/wiki/Letter_case#Stylistic_or_specialised_usage).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to convert.
     * @returns {string} Returns the start cased string.
     * @example
     *
     * _.startCase('--foo-bar');
     * // => 'Foo Bar'
     *
     * _.startCase('fooBar');
     * // => 'Foo Bar'
     *
     * _.startCase('__foo_bar__');
     * // => 'Foo Bar'
     */
    var startCase = createCompounder(function(result, word, index) {
      return result + (index ? ' ' : '') + (word.charAt(0).toUpperCase() + word.slice(1));
    });

    /**
     * Checks if `string` starts with the given target string.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to search.
     * @param {string} [target] The string to search for.
     * @param {number} [position=0] The position to search from.
     * @returns {boolean} Returns `true` if `string` starts with `target`, else `false`.
     * @example
     *
     * _.startsWith('abc', 'a');
     * // => true
     *
     * _.startsWith('abc', 'b');
     * // => false
     *
     * _.startsWith('abc', 'b', 1);
     * // => true
     */
    function startsWith(string, target, position) {
      string = baseToString(string);
      position = position == null
        ? 0
        : nativeMin(position < 0 ? 0 : (+position || 0), string.length);

      return string.lastIndexOf(target, position) == position;
    }

    /**
     * Creates a compiled template function that can interpolate data properties
     * in "interpolate" delimiters, HTML-escape interpolated data properties in
     * "escape" delimiters, and execute JavaScript in "evaluate" delimiters. Data
     * properties may be accessed as free variables in the template. If a setting
     * object is provided it takes precedence over `_.templateSettings` values.
     *
     * **Note:** In the development build `_.template` utilizes
     * [sourceURLs](http://www.html5rocks.com/en/tutorials/developertools/sourcemaps/#toc-sourceurl)
     * for easier debugging.
     *
     * For more information on precompiling templates see
     * [lodash's custom builds documentation](https://lodash.com/custom-builds).
     *
     * For more information on Chrome extension sandboxes see
     * [Chrome's extensions documentation](https://developer.chrome.com/extensions/sandboxingEval).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The template string.
     * @param {Object} [options] The options object.
     * @param {RegExp} [options.escape] The HTML "escape" delimiter.
     * @param {RegExp} [options.evaluate] The "evaluate" delimiter.
     * @param {Object} [options.imports] An object to import into the template as free variables.
     * @param {RegExp} [options.interpolate] The "interpolate" delimiter.
     * @param {string} [options.sourceURL] The sourceURL of the template's compiled source.
     * @param {string} [options.variable] The data object variable name.
     * @param- {Object} [otherOptions] Enables the legacy `options` param signature.
     * @returns {Function} Returns the compiled template function.
     * @example
     *
     * // using the "interpolate" delimiter to create a compiled template
     * var compiled = _.template('hello <%= user %>!');
     * compiled({ 'user': 'fred' });
     * // => 'hello fred!'
     *
     * // using the HTML "escape" delimiter to escape data property values
     * var compiled = _.template('<b><%- value %></b>');
     * compiled({ 'value': '<script>' });
     * // => '<b>&lt;script&gt;</b>'
     *
     * // using the "evaluate" delimiter to execute JavaScript and generate HTML
     * var compiled = _.template('<% _.forEach(users, function(user) { %><li><%- user %></li><% }); %>');
     * compiled({ 'users': ['fred', 'barney'] });
     * // => '<li>fred</li><li>barney</li>'
     *
     * // using the internal `print` function in "evaluate" delimiters
     * var compiled = _.template('<% print("hello " + user); %>!');
     * compiled({ 'user': 'barney' });
     * // => 'hello barney!'
     *
     * // using the ES delimiter as an alternative to the default "interpolate" delimiter
     * var compiled = _.template('hello ${ user }!');
     * compiled({ 'user': 'pebbles' });
     * // => 'hello pebbles!'
     *
     * // using custom template delimiters
     * _.templateSettings.interpolate = /{{([\s\S]+?)}}/g;
     * var compiled = _.template('hello {{ user }}!');
     * compiled({ 'user': 'mustache' });
     * // => 'hello mustache!'
     *
     * // using backslashes to treat delimiters as plain text
     * var compiled = _.template('<%= "\\<%- value %\\>" %>');
     * compiled({ 'value': 'ignored' });
     * // => '<%- value %>'
     *
     * // using the `imports` option to import `jQuery` as `jq`
     * var text = '<% jq.each(users, function(user) { %><li><%- user %></li><% }); %>';
     * var compiled = _.template(text, { 'imports': { 'jq': jQuery } });
     * compiled({ 'users': ['fred', 'barney'] });
     * // => '<li>fred</li><li>barney</li>'
     *
     * // using the `sourceURL` option to specify a custom sourceURL for the template
     * var compiled = _.template('hello <%= user %>!', { 'sourceURL': '/basic/greeting.jst' });
     * compiled(data);
     * // => find the source of "greeting.jst" under the Sources tab or Resources panel of the web inspector
     *
     * // using the `variable` option to ensure a with-statement isn't used in the compiled template
     * var compiled = _.template('hi <%= data.user %>!', { 'variable': 'data' });
     * compiled.source;
     * // => function(data) {
     * //   var __t, __p = '';
     * //   __p += 'hi ' + ((__t = ( data.user )) == null ? '' : __t) + '!';
     * //   return __p;
     * // }
     *
     * // using the `source` property to inline compiled templates for meaningful
     * // line numbers in error messages and a stack trace
     * fs.writeFileSync(path.join(cwd, 'jst.js'), '\
     *   var JST = {\
     *     "main": ' + _.template(mainText).source + '\
     *   };\
     * ');
     */
    function template(string, options, otherOptions) {
      // Based on John Resig's `tmpl` implementation (http://ejohn.org/blog/javascript-micro-templating/)
      // and Laura Doktorova's doT.js (https://github.com/olado/doT).
      var settings = lodash.templateSettings;

      if (otherOptions && isIterateeCall(string, options, otherOptions)) {
        options = otherOptions = undefined;
      }
      string = baseToString(string);
      options = assignWith(baseAssign({}, otherOptions || options), settings, assignOwnDefaults);

      var imports = assignWith(baseAssign({}, options.imports), settings.imports, assignOwnDefaults),
          importsKeys = keys(imports),
          importsValues = baseValues(imports, importsKeys);

      var isEscaping,
          isEvaluating,
          index = 0,
          interpolate = options.interpolate || reNoMatch,
          source = "__p += '";

      // Compile the regexp to match each delimiter.
      var reDelimiters = RegExp(
        (options.escape || reNoMatch).source + '|' +
        interpolate.source + '|' +
        (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + '|' +
        (options.evaluate || reNoMatch).source + '|$'
      , 'g');

      // Use a sourceURL for easier debugging.
      var sourceURL = '//# sourceURL=' +
        ('sourceURL' in options
          ? options.sourceURL
          : ('lodash.templateSources[' + (++templateCounter) + ']')
        ) + '\n';

      string.replace(reDelimiters, function(match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
        interpolateValue || (interpolateValue = esTemplateValue);

        // Escape characters that can't be included in string literals.
        source += string.slice(index, offset).replace(reUnescapedString, escapeStringChar);

        // Replace delimiters with snippets.
        if (escapeValue) {
          isEscaping = true;
          source += "' +\n__e(" + escapeValue + ") +\n'";
        }
        if (evaluateValue) {
          isEvaluating = true;
          source += "';\n" + evaluateValue + ";\n__p += '";
        }
        if (interpolateValue) {
          source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
        }
        index = offset + match.length;

        // The JS engine embedded in Adobe products requires returning the `match`
        // string in order to produce the correct `offset` value.
        return match;
      });

      source += "';\n";

      // If `variable` is not specified wrap a with-statement around the generated
      // code to add the data object to the top of the scope chain.
      var variable = options.variable;
      if (!variable) {
        source = 'with (obj) {\n' + source + '\n}\n';
      }
      // Cleanup code by stripping empty strings.
      source = (isEvaluating ? source.replace(reEmptyStringLeading, '') : source)
        .replace(reEmptyStringMiddle, '$1')
        .replace(reEmptyStringTrailing, '$1;');

      // Frame code as the function body.
      source = 'function(' + (variable || 'obj') + ') {\n' +
        (variable
          ? ''
          : 'obj || (obj = {});\n'
        ) +
        "var __t, __p = ''" +
        (isEscaping
           ? ', __e = _.escape'
           : ''
        ) +
        (isEvaluating
          ? ', __j = Array.prototype.join;\n' +
            "function print() { __p += __j.call(arguments, '') }\n"
          : ';\n'
        ) +
        source +
        'return __p\n}';

      var result = attempt(function() {
        return Function(importsKeys, sourceURL + 'return ' + source).apply(undefined, importsValues);
      });

      // Provide the compiled function's source by its `toString` method or
      // the `source` property as a convenience for inlining compiled templates.
      result.source = source;
      if (isError(result)) {
        throw result;
      }
      return result;
    }

    /**
     * Removes leading and trailing whitespace or specified characters from `string`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to trim.
     * @param {string} [chars=whitespace] The characters to trim.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {string} Returns the trimmed string.
     * @example
     *
     * _.trim('  abc  ');
     * // => 'abc'
     *
     * _.trim('-_-abc-_-', '_-');
     * // => 'abc'
     *
     * _.map(['  foo  ', '  bar  '], _.trim);
     * // => ['foo', 'bar']
     */
    function trim(string, chars, guard) {
      var value = string;
      string = baseToString(string);
      if (!string) {
        return string;
      }
      if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
        return string.slice(trimmedLeftIndex(string), trimmedRightIndex(string) + 1);
      }
      chars = (chars + '');
      return string.slice(charsLeftIndex(string, chars), charsRightIndex(string, chars) + 1);
    }

    /**
     * Removes leading whitespace or specified characters from `string`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to trim.
     * @param {string} [chars=whitespace] The characters to trim.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {string} Returns the trimmed string.
     * @example
     *
     * _.trimLeft('  abc  ');
     * // => 'abc  '
     *
     * _.trimLeft('-_-abc-_-', '_-');
     * // => 'abc-_-'
     */
    function trimLeft(string, chars, guard) {
      var value = string;
      string = baseToString(string);
      if (!string) {
        return string;
      }
      if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
        return string.slice(trimmedLeftIndex(string));
      }
      return string.slice(charsLeftIndex(string, (chars + '')));
    }

    /**
     * Removes trailing whitespace or specified characters from `string`.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to trim.
     * @param {string} [chars=whitespace] The characters to trim.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {string} Returns the trimmed string.
     * @example
     *
     * _.trimRight('  abc  ');
     * // => '  abc'
     *
     * _.trimRight('-_-abc-_-', '_-');
     * // => '-_-abc'
     */
    function trimRight(string, chars, guard) {
      var value = string;
      string = baseToString(string);
      if (!string) {
        return string;
      }
      if (guard ? isIterateeCall(value, chars, guard) : chars == null) {
        return string.slice(0, trimmedRightIndex(string) + 1);
      }
      return string.slice(0, charsRightIndex(string, (chars + '')) + 1);
    }

    /**
     * Truncates `string` if it's longer than the given maximum string length.
     * The last characters of the truncated string are replaced with the omission
     * string which defaults to "...".
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to truncate.
     * @param {Object|number} [options] The options object or maximum string length.
     * @param {number} [options.length=30] The maximum string length.
     * @param {string} [options.omission='...'] The string to indicate text is omitted.
     * @param {RegExp|string} [options.separator] The separator pattern to truncate to.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {string} Returns the truncated string.
     * @example
     *
     * _.trunc('hi-diddly-ho there, neighborino');
     * // => 'hi-diddly-ho there, neighbo...'
     *
     * _.trunc('hi-diddly-ho there, neighborino', 24);
     * // => 'hi-diddly-ho there, n...'
     *
     * _.trunc('hi-diddly-ho there, neighborino', {
     *   'length': 24,
     *   'separator': ' '
     * });
     * // => 'hi-diddly-ho there,...'
     *
     * _.trunc('hi-diddly-ho there, neighborino', {
     *   'length': 24,
     *   'separator': /,? +/
     * });
     * // => 'hi-diddly-ho there...'
     *
     * _.trunc('hi-diddly-ho there, neighborino', {
     *   'omission': ' [...]'
     * });
     * // => 'hi-diddly-ho there, neig [...]'
     */
    function trunc(string, options, guard) {
      if (guard && isIterateeCall(string, options, guard)) {
        options = undefined;
      }
      var length = DEFAULT_TRUNC_LENGTH,
          omission = DEFAULT_TRUNC_OMISSION;

      if (options != null) {
        if (isObject(options)) {
          var separator = 'separator' in options ? options.separator : separator;
          length = 'length' in options ? (+options.length || 0) : length;
          omission = 'omission' in options ? baseToString(options.omission) : omission;
        } else {
          length = +options || 0;
        }
      }
      string = baseToString(string);
      if (length >= string.length) {
        return string;
      }
      var end = length - omission.length;
      if (end < 1) {
        return omission;
      }
      var result = string.slice(0, end);
      if (separator == null) {
        return result + omission;
      }
      if (isRegExp(separator)) {
        if (string.slice(end).search(separator)) {
          var match,
              newEnd,
              substring = string.slice(0, end);

          if (!separator.global) {
            separator = RegExp(separator.source, (reFlags.exec(separator) || '') + 'g');
          }
          separator.lastIndex = 0;
          while ((match = separator.exec(substring))) {
            newEnd = match.index;
          }
          result = result.slice(0, newEnd == null ? end : newEnd);
        }
      } else if (string.indexOf(separator, end) != end) {
        var index = result.lastIndexOf(separator);
        if (index > -1) {
          result = result.slice(0, index);
        }
      }
      return result + omission;
    }

    /**
     * The inverse of `_.escape`; this method converts the HTML entities
     * `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, and `&#96;` in `string` to their
     * corresponding characters.
     *
     * **Note:** No other HTML entities are unescaped. To unescape additional HTML
     * entities use a third-party library like [_he_](https://mths.be/he).
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to unescape.
     * @returns {string} Returns the unescaped string.
     * @example
     *
     * _.unescape('fred, barney, &amp; pebbles');
     * // => 'fred, barney, & pebbles'
     */
    function unescape(string) {
      string = baseToString(string);
      return (string && reHasEscapedHtml.test(string))
        ? string.replace(reEscapedHtml, unescapeHtmlChar)
        : string;
    }

    /**
     * Splits `string` into an array of its words.
     *
     * @static
     * @memberOf _
     * @category String
     * @param {string} [string=''] The string to inspect.
     * @param {RegExp|string} [pattern] The pattern to match words.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Array} Returns the words of `string`.
     * @example
     *
     * _.words('fred, barney, & pebbles');
     * // => ['fred', 'barney', 'pebbles']
     *
     * _.words('fred, barney, & pebbles', /[^, ]+/g);
     * // => ['fred', 'barney', '&', 'pebbles']
     */
    function words(string, pattern, guard) {
      if (guard && isIterateeCall(string, pattern, guard)) {
        pattern = undefined;
      }
      string = baseToString(string);
      return string.match(pattern || reWords) || [];
    }

    /*------------------------------------------------------------------------*/

    /**
     * Attempts to invoke `func`, returning either the result or the caught error
     * object. Any additional arguments are provided to `func` when it's invoked.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Function} func The function to attempt.
     * @returns {*} Returns the `func` result or error object.
     * @example
     *
     * // avoid throwing errors for invalid selectors
     * var elements = _.attempt(function(selector) {
     *   return document.querySelectorAll(selector);
     * }, '>_>');
     *
     * if (_.isError(elements)) {
     *   elements = [];
     * }
     */
    var attempt = restParam(function(func, args) {
      try {
        return func.apply(undefined, args);
      } catch(e) {
        return isError(e) ? e : new Error(e);
      }
    });

    /**
     * Creates a function that invokes `func` with the `this` binding of `thisArg`
     * and arguments of the created function. If `func` is a property name the
     * created callback returns the property value for a given element. If `func`
     * is an object the created callback returns `true` for elements that contain
     * the equivalent object properties, otherwise it returns `false`.
     *
     * @static
     * @memberOf _
     * @alias iteratee
     * @category Utility
     * @param {*} [func=_.identity] The value to convert to a callback.
     * @param {*} [thisArg] The `this` binding of `func`.
     * @param- {Object} [guard] Enables use as a callback for functions like `_.map`.
     * @returns {Function} Returns the callback.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 40 }
     * ];
     *
     * // wrap to create custom callback shorthands
     * _.callback = _.wrap(_.callback, function(callback, func, thisArg) {
     *   var match = /^(.+?)__([gl]t)(.+)$/.exec(func);
     *   if (!match) {
     *     return callback(func, thisArg);
     *   }
     *   return function(object) {
     *     return match[2] == 'gt'
     *       ? object[match[1]] > match[3]
     *       : object[match[1]] < match[3];
     *   };
     * });
     *
     * _.filter(users, 'age__gt36');
     * // => [{ 'user': 'fred', 'age': 40 }]
     */
    function callback(func, thisArg, guard) {
      if (guard && isIterateeCall(func, thisArg, guard)) {
        thisArg = undefined;
      }
      return isObjectLike(func)
        ? matches(func)
        : baseCallback(func, thisArg);
    }

    /**
     * Creates a function that returns `value`.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {*} value The value to return from the new function.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var object = { 'user': 'fred' };
     * var getter = _.constant(object);
     *
     * getter() === object;
     * // => true
     */
    function constant(value) {
      return function() {
        return value;
      };
    }

    /**
     * This method returns the first argument provided to it.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {*} value Any value.
     * @returns {*} Returns `value`.
     * @example
     *
     * var object = { 'user': 'fred' };
     *
     * _.identity(object) === object;
     * // => true
     */
    function identity(value) {
      return value;
    }

    /**
     * Creates a function that performs a deep comparison between a given object
     * and `source`, returning `true` if the given object has equivalent property
     * values, else `false`.
     *
     * **Note:** This method supports comparing arrays, booleans, `Date` objects,
     * numbers, `Object` objects, regexes, and strings. Objects are compared by
     * their own, not inherited, enumerable properties. For comparing a single
     * own or inherited property value see `_.matchesProperty`.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Object} source The object of property values to match.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36, 'active': true },
     *   { 'user': 'fred',   'age': 40, 'active': false }
     * ];
     *
     * _.filter(users, _.matches({ 'age': 40, 'active': false }));
     * // => [{ 'user': 'fred', 'age': 40, 'active': false }]
     */
    function matches(source) {
      return baseMatches(baseClone(source, true));
    }

    /**
     * Creates a function that compares the property value of `path` on a given
     * object to `value`.
     *
     * **Note:** This method supports comparing arrays, booleans, `Date` objects,
     * numbers, `Object` objects, regexes, and strings. Objects are compared by
     * their own, not inherited, enumerable properties.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Array|string} path The path of the property to get.
     * @param {*} srcValue The value to match.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var users = [
     *   { 'user': 'barney' },
     *   { 'user': 'fred' }
     * ];
     *
     * _.find(users, _.matchesProperty('user', 'fred'));
     * // => { 'user': 'fred' }
     */
    function matchesProperty(path, srcValue) {
      return baseMatchesProperty(path, baseClone(srcValue, true));
    }

    /**
     * Creates a function that invokes the method at `path` on a given object.
     * Any additional arguments are provided to the invoked method.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Array|string} path The path of the method to invoke.
     * @param {...*} [args] The arguments to invoke the method with.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var objects = [
     *   { 'a': { 'b': { 'c': _.constant(2) } } },
     *   { 'a': { 'b': { 'c': _.constant(1) } } }
     * ];
     *
     * _.map(objects, _.method('a.b.c'));
     * // => [2, 1]
     *
     * _.invoke(_.sortBy(objects, _.method(['a', 'b', 'c'])), 'a.b.c');
     * // => [1, 2]
     */
    var method = restParam(function(path, args) {
      return function(object) {
        return invokePath(object, path, args);
      };
    });

    /**
     * The opposite of `_.method`; this method creates a function that invokes
     * the method at a given path on `object`. Any additional arguments are
     * provided to the invoked method.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Object} object The object to query.
     * @param {...*} [args] The arguments to invoke the method with.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var array = _.times(3, _.constant),
     *     object = { 'a': array, 'b': array, 'c': array };
     *
     * _.map(['a[2]', 'c[0]'], _.methodOf(object));
     * // => [2, 0]
     *
     * _.map([['a', '2'], ['c', '0']], _.methodOf(object));
     * // => [2, 0]
     */
    var methodOf = restParam(function(object, args) {
      return function(path) {
        return invokePath(object, path, args);
      };
    });

    /**
     * Adds all own enumerable function properties of a source object to the
     * destination object. If `object` is a function then methods are added to
     * its prototype as well.
     *
     * **Note:** Use `_.runInContext` to create a pristine `lodash` function to
     * avoid conflicts caused by modifying the original.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Function|Object} [object=lodash] The destination object.
     * @param {Object} source The object of functions to add.
     * @param {Object} [options] The options object.
     * @param {boolean} [options.chain=true] Specify whether the functions added
     *  are chainable.
     * @returns {Function|Object} Returns `object`.
     * @example
     *
     * function vowels(string) {
     *   return _.filter(string, function(v) {
     *     return /[aeiou]/i.test(v);
     *   });
     * }
     *
     * _.mixin({ 'vowels': vowels });
     * _.vowels('fred');
     * // => ['e']
     *
     * _('fred').vowels().value();
     * // => ['e']
     *
     * _.mixin({ 'vowels': vowels }, { 'chain': false });
     * _('fred').vowels();
     * // => ['e']
     */
    function mixin(object, source, options) {
      if (options == null) {
        var isObj = isObject(source),
            props = isObj ? keys(source) : undefined,
            methodNames = (props && props.length) ? baseFunctions(source, props) : undefined;

        if (!(methodNames ? methodNames.length : isObj)) {
          methodNames = false;
          options = source;
          source = object;
          object = this;
        }
      }
      if (!methodNames) {
        methodNames = baseFunctions(source, keys(source));
      }
      var chain = true,
          index = -1,
          isFunc = isFunction(object),
          length = methodNames.length;

      if (options === false) {
        chain = false;
      } else if (isObject(options) && 'chain' in options) {
        chain = options.chain;
      }
      while (++index < length) {
        var methodName = methodNames[index],
            func = source[methodName];

        object[methodName] = func;
        if (isFunc) {
          object.prototype[methodName] = (function(func) {
            return function() {
              var chainAll = this.__chain__;
              if (chain || chainAll) {
                var result = object(this.__wrapped__),
                    actions = result.__actions__ = arrayCopy(this.__actions__);

                actions.push({ 'func': func, 'args': arguments, 'thisArg': object });
                result.__chain__ = chainAll;
                return result;
              }
              return func.apply(object, arrayPush([this.value()], arguments));
            };
          }(func));
        }
      }
      return object;
    }

    /**
     * Reverts the `_` variable to its previous value and returns a reference to
     * the `lodash` function.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @returns {Function} Returns the `lodash` function.
     * @example
     *
     * var lodash = _.noConflict();
     */
    function noConflict() {
      root._ = oldDash;
      return this;
    }

    /**
     * A no-operation function that returns `undefined` regardless of the
     * arguments it receives.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @example
     *
     * var object = { 'user': 'fred' };
     *
     * _.noop(object) === undefined;
     * // => true
     */
    function noop() {
      // No operation performed.
    }

    /**
     * Creates a function that returns the property value at `path` on a
     * given object.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Array|string} path The path of the property to get.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var objects = [
     *   { 'a': { 'b': { 'c': 2 } } },
     *   { 'a': { 'b': { 'c': 1 } } }
     * ];
     *
     * _.map(objects, _.property('a.b.c'));
     * // => [2, 1]
     *
     * _.pluck(_.sortBy(objects, _.property(['a', 'b', 'c'])), 'a.b.c');
     * // => [1, 2]
     */
    function property(path) {
      return isKey(path) ? baseProperty(path) : basePropertyDeep(path);
    }

    /**
     * The opposite of `_.property`; this method creates a function that returns
     * the property value at a given path on `object`.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {Object} object The object to query.
     * @returns {Function} Returns the new function.
     * @example
     *
     * var array = [0, 1, 2],
     *     object = { 'a': array, 'b': array, 'c': array };
     *
     * _.map(['a[2]', 'c[0]'], _.propertyOf(object));
     * // => [2, 0]
     *
     * _.map([['a', '2'], ['c', '0']], _.propertyOf(object));
     * // => [2, 0]
     */
    function propertyOf(object) {
      return function(path) {
        return baseGet(object, toPath(path), (path + ''));
      };
    }

    /**
     * Creates an array of numbers (positive and/or negative) progressing from
     * `start` up to, but not including, `end`. If `end` is not specified it's
     * set to `start` with `start` then set to `0`. If `end` is less than `start`
     * a zero-length range is created unless a negative `step` is specified.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {number} [start=0] The start of the range.
     * @param {number} end The end of the range.
     * @param {number} [step=1] The value to increment or decrement by.
     * @returns {Array} Returns the new array of numbers.
     * @example
     *
     * _.range(4);
     * // => [0, 1, 2, 3]
     *
     * _.range(1, 5);
     * // => [1, 2, 3, 4]
     *
     * _.range(0, 20, 5);
     * // => [0, 5, 10, 15]
     *
     * _.range(0, -4, -1);
     * // => [0, -1, -2, -3]
     *
     * _.range(1, 4, 0);
     * // => [1, 1, 1]
     *
     * _.range(0);
     * // => []
     */
    function range(start, end, step) {
      if (step && isIterateeCall(start, end, step)) {
        end = step = undefined;
      }
      start = +start || 0;
      step = step == null ? 1 : (+step || 0);

      if (end == null) {
        end = start;
        start = 0;
      } else {
        end = +end || 0;
      }
      // Use `Array(length)` so engines like Chakra and V8 avoid slower modes.
      // See https://youtu.be/XAqIpGU8ZZk#t=17m25s for more details.
      var index = -1,
          length = nativeMax(nativeCeil((end - start) / (step || 1)), 0),
          result = Array(length);

      while (++index < length) {
        result[index] = start;
        start += step;
      }
      return result;
    }

    /**
     * Invokes the iteratee function `n` times, returning an array of the results
     * of each invocation. The `iteratee` is bound to `thisArg` and invoked with
     * one argument; (index).
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {number} n The number of times to invoke `iteratee`.
     * @param {Function} [iteratee=_.identity] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {Array} Returns the array of results.
     * @example
     *
     * var diceRolls = _.times(3, _.partial(_.random, 1, 6, false));
     * // => [3, 6, 4]
     *
     * _.times(3, function(n) {
     *   mage.castSpell(n);
     * });
     * // => invokes `mage.castSpell(n)` three times with `n` of `0`, `1`, and `2`
     *
     * _.times(3, function(n) {
     *   this.cast(n);
     * }, mage);
     * // => also invokes `mage.castSpell(n)` three times
     */
    function times(n, iteratee, thisArg) {
      n = nativeFloor(n);

      // Exit early to avoid a JSC JIT bug in Safari 8
      // where `Array(0)` is treated as `Array(1)`.
      if (n < 1 || !nativeIsFinite(n)) {
        return [];
      }
      var index = -1,
          result = Array(nativeMin(n, MAX_ARRAY_LENGTH));

      iteratee = bindCallback(iteratee, thisArg, 1);
      while (++index < n) {
        if (index < MAX_ARRAY_LENGTH) {
          result[index] = iteratee(index);
        } else {
          iteratee(index);
        }
      }
      return result;
    }

    /**
     * Generates a unique ID. If `prefix` is provided the ID is appended to it.
     *
     * @static
     * @memberOf _
     * @category Utility
     * @param {string} [prefix] The value to prefix the ID with.
     * @returns {string} Returns the unique ID.
     * @example
     *
     * _.uniqueId('contact_');
     * // => 'contact_104'
     *
     * _.uniqueId();
     * // => '105'
     */
    function uniqueId(prefix) {
      var id = ++idCounter;
      return baseToString(prefix) + id;
    }

    /*------------------------------------------------------------------------*/

    /**
     * Adds two numbers.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {number} augend The first number to add.
     * @param {number} addend The second number to add.
     * @returns {number} Returns the sum.
     * @example
     *
     * _.add(6, 4);
     * // => 10
     */
    function add(augend, addend) {
      return (+augend || 0) + (+addend || 0);
    }

    /**
     * Calculates `n` rounded up to `precision`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {number} n The number to round up.
     * @param {number} [precision=0] The precision to round up to.
     * @returns {number} Returns the rounded up number.
     * @example
     *
     * _.ceil(4.006);
     * // => 5
     *
     * _.ceil(6.004, 2);
     * // => 6.01
     *
     * _.ceil(6040, -2);
     * // => 6100
     */
    var ceil = createRound('ceil');

    /**
     * Calculates `n` rounded down to `precision`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {number} n The number to round down.
     * @param {number} [precision=0] The precision to round down to.
     * @returns {number} Returns the rounded down number.
     * @example
     *
     * _.floor(4.006);
     * // => 4
     *
     * _.floor(0.046, 2);
     * // => 0.04
     *
     * _.floor(4060, -2);
     * // => 4000
     */
    var floor = createRound('floor');

    /**
     * Gets the maximum value of `collection`. If `collection` is empty or falsey
     * `-Infinity` is returned. If an iteratee function is provided it's invoked
     * for each value in `collection` to generate the criterion by which the value
     * is ranked. The `iteratee` is bound to `thisArg` and invoked with three
     * arguments: (value, index, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {*} Returns the maximum value.
     * @example
     *
     * _.max([4, 2, 8, 6]);
     * // => 8
     *
     * _.max([]);
     * // => -Infinity
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 40 }
     * ];
     *
     * _.max(users, function(chr) {
     *   return chr.age;
     * });
     * // => { 'user': 'fred', 'age': 40 }
     *
     * // using the `_.property` callback shorthand
     * _.max(users, 'age');
     * // => { 'user': 'fred', 'age': 40 }
     */
    var max = createExtremum(gt, NEGATIVE_INFINITY);

    /**
     * Gets the minimum value of `collection`. If `collection` is empty or falsey
     * `Infinity` is returned. If an iteratee function is provided it's invoked
     * for each value in `collection` to generate the criterion by which the value
     * is ranked. The `iteratee` is bound to `thisArg` and invoked with three
     * arguments: (value, index, collection).
     *
     * If a property name is provided for `iteratee` the created `_.property`
     * style callback returns the property value of the given element.
     *
     * If a value is also provided for `thisArg` the created `_.matchesProperty`
     * style callback returns `true` for elements that have a matching property
     * value, else `false`.
     *
     * If an object is provided for `iteratee` the created `_.matches` style
     * callback returns `true` for elements that have the properties of the given
     * object, else `false`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {*} Returns the minimum value.
     * @example
     *
     * _.min([4, 2, 8, 6]);
     * // => 2
     *
     * _.min([]);
     * // => Infinity
     *
     * var users = [
     *   { 'user': 'barney', 'age': 36 },
     *   { 'user': 'fred',   'age': 40 }
     * ];
     *
     * _.min(users, function(chr) {
     *   return chr.age;
     * });
     * // => { 'user': 'barney', 'age': 36 }
     *
     * // using the `_.property` callback shorthand
     * _.min(users, 'age');
     * // => { 'user': 'barney', 'age': 36 }
     */
    var min = createExtremum(lt, POSITIVE_INFINITY);

    /**
     * Calculates `n` rounded to `precision`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {number} n The number to round.
     * @param {number} [precision=0] The precision to round to.
     * @returns {number} Returns the rounded number.
     * @example
     *
     * _.round(4.006);
     * // => 4
     *
     * _.round(4.006, 2);
     * // => 4.01
     *
     * _.round(4060, -2);
     * // => 4100
     */
    var round = createRound('round');

    /**
     * Gets the sum of the values in `collection`.
     *
     * @static
     * @memberOf _
     * @category Math
     * @param {Array|Object|string} collection The collection to iterate over.
     * @param {Function|Object|string} [iteratee] The function invoked per iteration.
     * @param {*} [thisArg] The `this` binding of `iteratee`.
     * @returns {number} Returns the sum.
     * @example
     *
     * _.sum([4, 6]);
     * // => 10
     *
     * _.sum({ 'a': 4, 'b': 6 });
     * // => 10
     *
     * var objects = [
     *   { 'n': 4 },
     *   { 'n': 6 }
     * ];
     *
     * _.sum(objects, function(object) {
     *   return object.n;
     * });
     * // => 10
     *
     * // using the `_.property` callback shorthand
     * _.sum(objects, 'n');
     * // => 10
     */
    function sum(collection, iteratee, thisArg) {
      if (thisArg && isIterateeCall(collection, iteratee, thisArg)) {
        iteratee = undefined;
      }
      iteratee = getCallback(iteratee, thisArg, 3);
      return iteratee.length == 1
        ? arraySum(isArray(collection) ? collection : toIterable(collection), iteratee)
        : baseSum(collection, iteratee);
    }

    /*------------------------------------------------------------------------*/

    // Ensure wrappers are instances of `baseLodash`.
    lodash.prototype = baseLodash.prototype;

    LodashWrapper.prototype = baseCreate(baseLodash.prototype);
    LodashWrapper.prototype.constructor = LodashWrapper;

    LazyWrapper.prototype = baseCreate(baseLodash.prototype);
    LazyWrapper.prototype.constructor = LazyWrapper;

    // Add functions to the `Map` cache.
    MapCache.prototype['delete'] = mapDelete;
    MapCache.prototype.get = mapGet;
    MapCache.prototype.has = mapHas;
    MapCache.prototype.set = mapSet;

    // Add functions to the `Set` cache.
    SetCache.prototype.push = cachePush;

    // Assign cache to `_.memoize`.
    memoize.Cache = MapCache;

    // Add functions that return wrapped values when chaining.
    lodash.after = after;
    lodash.ary = ary;
    lodash.assign = assign;
    lodash.at = at;
    lodash.before = before;
    lodash.bind = bind;
    lodash.bindAll = bindAll;
    lodash.bindKey = bindKey;
    lodash.callback = callback;
    lodash.chain = chain;
    lodash.chunk = chunk;
    lodash.compact = compact;
    lodash.constant = constant;
    lodash.countBy = countBy;
    lodash.create = create;
    lodash.curry = curry;
    lodash.curryRight = curryRight;
    lodash.debounce = debounce;
    lodash.defaults = defaults;
    lodash.defaultsDeep = defaultsDeep;
    lodash.defer = defer;
    lodash.delay = delay;
    lodash.difference = difference;
    lodash.drop = drop;
    lodash.dropRight = dropRight;
    lodash.dropRightWhile = dropRightWhile;
    lodash.dropWhile = dropWhile;
    lodash.fill = fill;
    lodash.filter = filter;
    lodash.flatten = flatten;
    lodash.flattenDeep = flattenDeep;
    lodash.flow = flow;
    lodash.flowRight = flowRight;
    lodash.forEach = forEach;
    lodash.forEachRight = forEachRight;
    lodash.forIn = forIn;
    lodash.forInRight = forInRight;
    lodash.forOwn = forOwn;
    lodash.forOwnRight = forOwnRight;
    lodash.functions = functions;
    lodash.groupBy = groupBy;
    lodash.indexBy = indexBy;
    lodash.initial = initial;
    lodash.intersection = intersection;
    lodash.invert = invert;
    lodash.invoke = invoke;
    lodash.keys = keys;
    lodash.keysIn = keysIn;
    lodash.map = map;
    lodash.mapKeys = mapKeys;
    lodash.mapValues = mapValues;
    lodash.matches = matches;
    lodash.matchesProperty = matchesProperty;
    lodash.memoize = memoize;
    lodash.merge = merge;
    lodash.method = method;
    lodash.methodOf = methodOf;
    lodash.mixin = mixin;
    lodash.modArgs = modArgs;
    lodash.negate = negate;
    lodash.omit = omit;
    lodash.once = once;
    lodash.pairs = pairs;
    lodash.partial = partial;
    lodash.partialRight = partialRight;
    lodash.partition = partition;
    lodash.pick = pick;
    lodash.pluck = pluck;
    lodash.property = property;
    lodash.propertyOf = propertyOf;
    lodash.pull = pull;
    lodash.pullAt = pullAt;
    lodash.range = range;
    lodash.rearg = rearg;
    lodash.reject = reject;
    lodash.remove = remove;
    lodash.rest = rest;
    lodash.restParam = restParam;
    lodash.set = set;
    lodash.shuffle = shuffle;
    lodash.slice = slice;
    lodash.sortBy = sortBy;
    lodash.sortByAll = sortByAll;
    lodash.sortByOrder = sortByOrder;
    lodash.spread = spread;
    lodash.take = take;
    lodash.takeRight = takeRight;
    lodash.takeRightWhile = takeRightWhile;
    lodash.takeWhile = takeWhile;
    lodash.tap = tap;
    lodash.throttle = throttle;
    lodash.thru = thru;
    lodash.times = times;
    lodash.toArray = toArray;
    lodash.toPlainObject = toPlainObject;
    lodash.transform = transform;
    lodash.union = union;
    lodash.uniq = uniq;
    lodash.unzip = unzip;
    lodash.unzipWith = unzipWith;
    lodash.values = values;
    lodash.valuesIn = valuesIn;
    lodash.where = where;
    lodash.without = without;
    lodash.wrap = wrap;
    lodash.xor = xor;
    lodash.zip = zip;
    lodash.zipObject = zipObject;
    lodash.zipWith = zipWith;

    // Add aliases.
    lodash.backflow = flowRight;
    lodash.collect = map;
    lodash.compose = flowRight;
    lodash.each = forEach;
    lodash.eachRight = forEachRight;
    lodash.extend = assign;
    lodash.iteratee = callback;
    lodash.methods = functions;
    lodash.object = zipObject;
    lodash.select = filter;
    lodash.tail = rest;
    lodash.unique = uniq;

    // Add functions to `lodash.prototype`.
    mixin(lodash, lodash);

    /*------------------------------------------------------------------------*/

    // Add functions that return unwrapped values when chaining.
    lodash.add = add;
    lodash.attempt = attempt;
    lodash.camelCase = camelCase;
    lodash.capitalize = capitalize;
    lodash.ceil = ceil;
    lodash.clone = clone;
    lodash.cloneDeep = cloneDeep;
    lodash.deburr = deburr;
    lodash.endsWith = endsWith;
    lodash.escape = escape;
    lodash.escapeRegExp = escapeRegExp;
    lodash.every = every;
    lodash.find = find;
    lodash.findIndex = findIndex;
    lodash.findKey = findKey;
    lodash.findLast = findLast;
    lodash.findLastIndex = findLastIndex;
    lodash.findLastKey = findLastKey;
    lodash.findWhere = findWhere;
    lodash.first = first;
    lodash.floor = floor;
    lodash.get = get;
    lodash.gt = gt;
    lodash.gte = gte;
    lodash.has = has;
    lodash.identity = identity;
    lodash.includes = includes;
    lodash.indexOf = indexOf;
    lodash.inRange = inRange;
    lodash.isArguments = isArguments;
    lodash.isArray = isArray;
    lodash.isBoolean = isBoolean;
    lodash.isDate = isDate;
    lodash.isElement = isElement;
    lodash.isEmpty = isEmpty;
    lodash.isEqual = isEqual;
    lodash.isError = isError;
    lodash.isFinite = isFinite;
    lodash.isFunction = isFunction;
    lodash.isMatch = isMatch;
    lodash.isNaN = isNaN;
    lodash.isNative = isNative;
    lodash.isNull = isNull;
    lodash.isNumber = isNumber;
    lodash.isObject = isObject;
    lodash.isPlainObject = isPlainObject;
    lodash.isRegExp = isRegExp;
    lodash.isString = isString;
    lodash.isTypedArray = isTypedArray;
    lodash.isUndefined = isUndefined;
    lodash.kebabCase = kebabCase;
    lodash.last = last;
    lodash.lastIndexOf = lastIndexOf;
    lodash.lt = lt;
    lodash.lte = lte;
    lodash.max = max;
    lodash.min = min;
    lodash.noConflict = noConflict;
    lodash.noop = noop;
    lodash.now = now;
    lodash.pad = pad;
    lodash.padLeft = padLeft;
    lodash.padRight = padRight;
    lodash.parseInt = parseInt;
    lodash.random = random;
    lodash.reduce = reduce;
    lodash.reduceRight = reduceRight;
    lodash.repeat = repeat;
    lodash.result = result;
    lodash.round = round;
    lodash.runInContext = runInContext;
    lodash.size = size;
    lodash.snakeCase = snakeCase;
    lodash.some = some;
    lodash.sortedIndex = sortedIndex;
    lodash.sortedLastIndex = sortedLastIndex;
    lodash.startCase = startCase;
    lodash.startsWith = startsWith;
    lodash.sum = sum;
    lodash.template = template;
    lodash.trim = trim;
    lodash.trimLeft = trimLeft;
    lodash.trimRight = trimRight;
    lodash.trunc = trunc;
    lodash.unescape = unescape;
    lodash.uniqueId = uniqueId;
    lodash.words = words;

    // Add aliases.
    lodash.all = every;
    lodash.any = some;
    lodash.contains = includes;
    lodash.eq = isEqual;
    lodash.detect = find;
    lodash.foldl = reduce;
    lodash.foldr = reduceRight;
    lodash.head = first;
    lodash.include = includes;
    lodash.inject = reduce;

    mixin(lodash, (function() {
      var source = {};
      baseForOwn(lodash, function(func, methodName) {
        if (!lodash.prototype[methodName]) {
          source[methodName] = func;
        }
      });
      return source;
    }()), false);

    /*------------------------------------------------------------------------*/

    // Add functions capable of returning wrapped and unwrapped values when chaining.
    lodash.sample = sample;

    lodash.prototype.sample = function(n) {
      if (!this.__chain__ && n == null) {
        return sample(this.value());
      }
      return this.thru(function(value) {
        return sample(value, n);
      });
    };

    /*------------------------------------------------------------------------*/

    /**
     * The semantic version number.
     *
     * @static
     * @memberOf _
     * @type string
     */
    lodash.VERSION = VERSION;

    // Assign default placeholders.
    arrayEach(['bind', 'bindKey', 'curry', 'curryRight', 'partial', 'partialRight'], function(methodName) {
      lodash[methodName].placeholder = lodash;
    });

    // Add `LazyWrapper` methods for `_.drop` and `_.take` variants.
    arrayEach(['drop', 'take'], function(methodName, index) {
      LazyWrapper.prototype[methodName] = function(n) {
        var filtered = this.__filtered__;
        if (filtered && !index) {
          return new LazyWrapper(this);
        }
        n = n == null ? 1 : nativeMax(nativeFloor(n) || 0, 0);

        var result = this.clone();
        if (filtered) {
          result.__takeCount__ = nativeMin(result.__takeCount__, n);
        } else {
          result.__views__.push({ 'size': n, 'type': methodName + (result.__dir__ < 0 ? 'Right' : '') });
        }
        return result;
      };

      LazyWrapper.prototype[methodName + 'Right'] = function(n) {
        return this.reverse()[methodName](n).reverse();
      };
    });

    // Add `LazyWrapper` methods that accept an `iteratee` value.
    arrayEach(['filter', 'map', 'takeWhile'], function(methodName, index) {
      var type = index + 1,
          isFilter = type != LAZY_MAP_FLAG;

      LazyWrapper.prototype[methodName] = function(iteratee, thisArg) {
        var result = this.clone();
        result.__iteratees__.push({ 'iteratee': getCallback(iteratee, thisArg, 1), 'type': type });
        result.__filtered__ = result.__filtered__ || isFilter;
        return result;
      };
    });

    // Add `LazyWrapper` methods for `_.first` and `_.last`.
    arrayEach(['first', 'last'], function(methodName, index) {
      var takeName = 'take' + (index ? 'Right' : '');

      LazyWrapper.prototype[methodName] = function() {
        return this[takeName](1).value()[0];
      };
    });

    // Add `LazyWrapper` methods for `_.initial` and `_.rest`.
    arrayEach(['initial', 'rest'], function(methodName, index) {
      var dropName = 'drop' + (index ? '' : 'Right');

      LazyWrapper.prototype[methodName] = function() {
        return this.__filtered__ ? new LazyWrapper(this) : this[dropName](1);
      };
    });

    // Add `LazyWrapper` methods for `_.pluck` and `_.where`.
    arrayEach(['pluck', 'where'], function(methodName, index) {
      var operationName = index ? 'filter' : 'map',
          createCallback = index ? baseMatches : property;

      LazyWrapper.prototype[methodName] = function(value) {
        return this[operationName](createCallback(value));
      };
    });

    LazyWrapper.prototype.compact = function() {
      return this.filter(identity);
    };

    LazyWrapper.prototype.reject = function(predicate, thisArg) {
      predicate = getCallback(predicate, thisArg, 1);
      return this.filter(function(value) {
        return !predicate(value);
      });
    };

    LazyWrapper.prototype.slice = function(start, end) {
      start = start == null ? 0 : (+start || 0);

      var result = this;
      if (result.__filtered__ && (start > 0 || end < 0)) {
        return new LazyWrapper(result);
      }
      if (start < 0) {
        result = result.takeRight(-start);
      } else if (start) {
        result = result.drop(start);
      }
      if (end !== undefined) {
        end = (+end || 0);
        result = end < 0 ? result.dropRight(-end) : result.take(end - start);
      }
      return result;
    };

    LazyWrapper.prototype.takeRightWhile = function(predicate, thisArg) {
      return this.reverse().takeWhile(predicate, thisArg).reverse();
    };

    LazyWrapper.prototype.toArray = function() {
      return this.take(POSITIVE_INFINITY);
    };

    // Add `LazyWrapper` methods to `lodash.prototype`.
    baseForOwn(LazyWrapper.prototype, function(func, methodName) {
      var checkIteratee = /^(?:filter|map|reject)|While$/.test(methodName),
          retUnwrapped = /^(?:first|last)$/.test(methodName),
          lodashFunc = lodash[retUnwrapped ? ('take' + (methodName == 'last' ? 'Right' : '')) : methodName];

      if (!lodashFunc) {
        return;
      }
      lodash.prototype[methodName] = function() {
        var args = retUnwrapped ? [1] : arguments,
            chainAll = this.__chain__,
            value = this.__wrapped__,
            isHybrid = !!this.__actions__.length,
            isLazy = value instanceof LazyWrapper,
            iteratee = args[0],
            useLazy = isLazy || isArray(value);

        if (useLazy && checkIteratee && typeof iteratee == 'function' && iteratee.length != 1) {
          // Avoid lazy use if the iteratee has a "length" value other than `1`.
          isLazy = useLazy = false;
        }
        var interceptor = function(value) {
          return (retUnwrapped && chainAll)
            ? lodashFunc(value, 1)[0]
            : lodashFunc.apply(undefined, arrayPush([value], args));
        };

        var action = { 'func': thru, 'args': [interceptor], 'thisArg': undefined },
            onlyLazy = isLazy && !isHybrid;

        if (retUnwrapped && !chainAll) {
          if (onlyLazy) {
            value = value.clone();
            value.__actions__.push(action);
            return func.call(value);
          }
          return lodashFunc.call(undefined, this.value())[0];
        }
        if (!retUnwrapped && useLazy) {
          value = onlyLazy ? value : new LazyWrapper(this);
          var result = func.apply(value, args);
          result.__actions__.push(action);
          return new LodashWrapper(result, chainAll);
        }
        return this.thru(interceptor);
      };
    });

    // Add `Array` and `String` methods to `lodash.prototype`.
    arrayEach(['join', 'pop', 'push', 'replace', 'shift', 'sort', 'splice', 'split', 'unshift'], function(methodName) {
      var protoFunc = (/^(?:replace|split)$/.test(methodName) ? stringProto : arrayProto)[methodName],
          chainName = /^(?:push|sort|unshift)$/.test(methodName) ? 'tap' : 'thru',
          fixObjects = !support.spliceObjects && /^(?:pop|shift|splice)$/.test(methodName),
          retUnwrapped = /^(?:join|pop|replace|shift)$/.test(methodName);

      // Avoid array-like object bugs with `Array#shift` and `Array#splice` in
      // IE < 9, Firefox < 10, and RingoJS.
      var func = !fixObjects ? protoFunc : function() {
        var result = protoFunc.apply(this, arguments);
        if (this.length === 0) {
          delete this[0];
        }
        return result;
      };

      lodash.prototype[methodName] = function() {
        var args = arguments;
        if (retUnwrapped && !this.__chain__) {
          return func.apply(this.value(), args);
        }
        return this[chainName](function(value) {
          return func.apply(value, args);
        });
      };
    });

    // Map minified function names to their real names.
    baseForOwn(LazyWrapper.prototype, function(func, methodName) {
      var lodashFunc = lodash[methodName];
      if (lodashFunc) {
        var key = (lodashFunc.name + ''),
            names = realNames[key] || (realNames[key] = []);

        names.push({ 'name': methodName, 'func': lodashFunc });
      }
    });

    realNames[createHybridWrapper(undefined, BIND_KEY_FLAG).name] = [{ 'name': 'wrapper', 'func': undefined }];

    // Add functions to the lazy wrapper.
    LazyWrapper.prototype.clone = lazyClone;
    LazyWrapper.prototype.reverse = lazyReverse;
    LazyWrapper.prototype.value = lazyValue;

    // Add chaining functions to the `lodash` wrapper.
    lodash.prototype.chain = wrapperChain;
    lodash.prototype.commit = wrapperCommit;
    lodash.prototype.concat = wrapperConcat;
    lodash.prototype.plant = wrapperPlant;
    lodash.prototype.reverse = wrapperReverse;
    lodash.prototype.toString = wrapperToString;
    lodash.prototype.run = lodash.prototype.toJSON = lodash.prototype.valueOf = lodash.prototype.value = wrapperValue;

    // Add function aliases to the `lodash` wrapper.
    lodash.prototype.collect = lodash.prototype.map;
    lodash.prototype.head = lodash.prototype.first;
    lodash.prototype.select = lodash.prototype.filter;
    lodash.prototype.tail = lodash.prototype.rest;

    return lodash;
  }

  /*--------------------------------------------------------------------------*/

  // Export lodash.
  var _ = runInContext();

  // Some AMD build optimizers like r.js check for condition patterns like the following:
  if (typeof define == 'function' && typeof define.amd == 'object' && define.amd) {
    // Define as an anonymous module so, through path mapping, it can be
    // referenced as the "underscore" module.
    define('lodash/main',[],function() {
      return _;
    });
  }
}.call(this));

define('lodash', ['lodash/main'], function (main) { return main; });

/*!
 * Web Cabin Docker - Docking Layout Interface.
 *
 * Dependencies:
 *  JQuery 1.11.1
 *  JQuery-contextMenu 1.6.6
 *  font-awesome 4.2.0
 *
 * Author: Jeff Houde (lochemage@webcabin.org)
 * Web: https://docker.webcabin.org/
 *
 * Licensed under
 *   MIT License http://www.opensource.org/licenses/mit-license
 *   GPL v3 http://opensource.org/licenses/GPL-3.0
 *
 */
/** @module wcDocker */
define('wcDocker/docker',[
    "dcl/dcl",
    "./types",
    './panel',
    './ghost',
    './splitter',
    './frame',
    './collapser',
    './layoutsimple',
    './layouttable',
    './tabframe',
    './drawer',
    './base',
    'lodash'
], function (dcl, wcDocker, wcPanel, wcGhost, wcSplitter, wcFrame, wcCollapser, wcLayoutSimple, wcLayoutTable, wcTabFrame, wcDrawer, base,_) {

    /**
     * Default class name to module mapping, being used for default options
     */
    var defaultClasses = {
        'wcPanel': wcPanel,
        'wcGhost': wcGhost,
        'wcSplitter': wcSplitter,
        'wcFrame': wcFrame,
        'wcCollapser': wcCollapser,
        'wcLayoutSimple': wcLayoutSimple,
        'wcLayoutTable': wcLayoutTable,
        'wcDrawer': wcDrawer,
        'wcTabFrame': wcTabFrame
    };

    /**
     * @class
     *
     * The main docker instance.  This manages all of the docking panels and user input.
     * There should only be one instance of this, although it is not enforced.<br>
     * See {@tutorial getting-started}
     */
    var Module = dcl(base, {
        declaredClass: 'wcDocker',

        /**
         *
         * @memberOf module:wcDocker
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element to store the contents of wcDocker.
         * @param {module:wcDocker~Options} [options] - Options for constructing the instance.
         */
        constructor: function (container, options) {

            this.$outer = $(container);
            this.$container = $('<div class="wcDocker">');
            this.$transition = $('<div class="wcDockerTransition">');
            this.$loading = null;

            this.$outer.append(this.$container);
            this.$container.append(this.$transition);

            this._canOrientTabs = true;

            this._events = {};

            this._root = null;
            this._frameList = [];
            this._floatingList = [];
            this._modalList = [];
            this._persistentList = [];
            this._focusFrame = null;
            this._placeholderPanel = null;
            this._contextTimer = 0;
            this._dirty = false;
            this._dirtyDontMove = false;

            this._splitterList = [];
            this._tabList = [];
            this._collapser = {};

            this._dockPanelTypeList = [];

            this._creatingPanel = false;
            this._draggingSplitter = null;
            this._draggingFrame = null;
            this._draggingFrameSizer = null;
            this._draggingFrameTab = null;
            this._draggingFrameTopper = false;
            this._draggingCustomTabFrame = null;
            this._ghost = null;
            this._menuTimer = 0;
            this._mouseOrigin = {x: 0, y: 0};

            this._resizeData = {
                time: -1,
                timeout: false,
                delta: 150
            };

            var defaultOptions = {
                themePath: 'Themes',
                theme: 'default',
                loadingClass: 'fa fa-spinner fa-pulse',
                allowContextMenu: true,
                hideOnResize: false,
                allowCollapse: true,
                responseRate: 10,
                moveStartDelay: 300,
                edgeAnchorSize: 50,
                panelAnchorSize: '15%',
                detachToWidth: '50%',
                detachToHeight: '50%',
                allowTabs: true
            };

            this._options = {};

            //replay default classes into default options
            for (var prop in defaultClasses) {
                defaultOptions[prop+'Class'] = defaultClasses[prop];
            }

            for (var prop in defaultOptions) {
                this._options[prop] = defaultOptions[prop];
            }

            for (var prop in options) {
                this._options[prop] = options[prop];
            }

            this.__init();
        },
        
        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Gets, or Sets the path where all theme files can be found.
         * "Themes" is the default folder path.
         * @function module:wcDocker#themePath
         * @param {String} path - If supplied, will set the path where all themes can be found.
         * @returns {String} - The currently assigned path.
         */
        themePath: function (path) {
            if (path !== undefined) {
                this._options.themePath = path;
            }
            return this._options.themePath;
        },

        /**
         * Gets, or Sets the current theme used by docker.
         * @function module:wcDocker#theme
         * @param {String} themeName - If supplied, will activate a theme with the given name.
         * @returns {String} - The currently active theme.
         */
        theme: function (themeName) {
            if (themeName !== undefined) {
                var $oldTheme = $('#wcTheme');

                // The default theme requires no additional theme css file.
                var cacheBreak = (new Date()).getTime();
                var ext = themeName.indexOf('.css');
                if (ext > -1) {
                    themeName = themeName.substring(0, ext);
                }
                var $link = $('<link id="wcTheme" rel="stylesheet" type="text/css" href="' + this._options.themePath + '/' + themeName + '.css?v=' + cacheBreak + '"/>');
                this._options.theme = themeName;

                var self = this;
                $link[0].onload = function () {
                    $oldTheme.remove();
                    self.__update();
                };

                $('head').append($link);
            }

            return this._options.theme;
        },

        /**
         * Retrieves whether panel collapsers are enabled.
         * @function module:wcDocker#isCollapseEnabled
         * @version 3.0.0
         * @returns {Boolean} - Collapsers are enabled.
         */
        isCollapseEnabled: function () {
            return (this._canOrientTabs && this._options.allowCollapse);
        },

        /**
         * Registers a new docking panel type to be used later.
         * @function module:wcDocker#registerPanelType
         * @version 3.0.0
         * @param {String} name - The name identifier for the new panel type.
         * @param {module:wcDocker~registerOptions} options  An options object for describing the panel type.
         * @param {Boolean} [isPrivate] - <b>DEPRECATED:</b> Use [options.isPrivate]{@link wcDocker~registerOptions} instead.
         * @returns {Boolean} - Success or failure. Failure usually indicates the type name already exists.
         */
        registerPanelType: function (name, optionsOrCreateFunc, isPrivate) {

            var options = optionsOrCreateFunc;
            if (typeof options === 'function') {
                options = {
                    onCreate: optionsOrCreateFunc
                };
                console.log("WARNING: Passing in the creation function directly to wcDocker.registerPanelType parameter 2 is now deprecated and will be removed in the next version!  Please use the preferred options object instead.");
            }

            if (typeof isPrivate != 'undefined') {
                options.isPrivate = isPrivate;
                console.log("WARNING: Passing in the isPrivate flag to wcDocker.registerPanelType parameter 3 is now deprecated and will be removed in the next version!  Please use the preferred options object instead.");
            }

            if ($.isEmptyObject(options)) {
                options = null;
            }

            for (var i = 0; i < this._dockPanelTypeList.length; ++i) {
                if (this._dockPanelTypeList[i].name === name) {
                    return false;
                }
            }

            this._dockPanelTypeList.push({
                name: name,
                options: options
            });

            var $menu = $('menu').find('menu');
            $menu.append($('<menuitem label="' + name + '">'));
            return true;
        },

        /**
         * Retrieves a list of all currently registered panel types.
         * @function module:wcDocker#panelTypes
         * @param {Boolean} includePrivate - If true, panels registered as private will also be included with this list.
         * @returns {String[]} - A list of panel type names.
         */
        panelTypes: function (includePrivate) {
            var result = [];
            for (var i = 0; i < this._dockPanelTypeList.length; ++i) {
                if (includePrivate || !this._dockPanelTypeList[i].options.isPrivate) {
                    result.push(this._dockPanelTypeList[i].name);
                }
            }
            return result;
        },

        /**
         * Retrieves the options data associated with a given panel type when it was registered.
         * @function module:wcDocker#panelTypeInfo
         * @param {String} typeName - The name identifier of the panel.
         * @returns {module:wcDocker~registerOptions} - Registered options of the panel type, or false if the panel was not found.
         */
        panelTypeInfo: function (typeName) {
            for (var i = 0; i < this._dockPanelTypeList.length; ++i) {
                if (this._dockPanelTypeList[i].name == typeName) {
                    return this._dockPanelTypeList[i].options;
                }
            }
            return false;
        },

        /**
         * Add a new docked panel to the docker instance.<br>
         * <b>Note:</b> It is best to use {@link wcDocker.COLLAPSED} after you have added your other docked panels, as it may ensure proper placement.
         * @function module:wcDocker#addPanel
         * @param {String} typeName - The name identifier of the panel to create.
         * @param {module:wcDocker.DOCK} location - The docking location to place this panel.
         * @param {module:wcPanel|module:wcDocker.COLLAPSED} [targetPanel] - A target panel to dock relative to, or use {@link wcDocker.COLLAPSED} to collapse it to the side or bottom.
         * @param {module:wcDocker~PanelOptions} [options] - Other options for panel placement.
         * @returns {module:wcPanel|Boolean} - The newly created panel object, or false if no panel was created.
         */
        addPanel: function (typeName, location, targetPanel, options, arg) {
            function __addPanel(panel) {
                if (location === wcDocker.DOCK.STACKED) {
                    this.__addPanelGrouped(panel, targetPanel, options);
                } else {
                    this.__addPanelAlone(panel, location, targetPanel, options);
                }

                if (this._placeholderPanel && panel.moveable() &&
                    location !== wcDocker.DOCK.FLOAT &&
                    location !== wcDocker.DOCK.MODAL) {
                    if (this.removePanel(this._placeholderPanel)) {
                        this._placeholderPanel = null;
                    }
                }

                this.__forceUpdate();
            }

            // Find out if we have a persistent version of this panel type first.
            for (var a = 0; a < this._persistentList.length; ++a) {
                if (this._persistentList[a]._type === typeName) {
                    var panel = this._persistentList.splice(a, 1)[0];
                    __addPanel.call(this, panel);
                    panel.__trigger(wcDocker.EVENT.PERSISTENT_OPENED);
                    return panel;
                }
            }

            for (var i = 0; i < this._dockPanelTypeList.length; ++i) {
                if (this._dockPanelTypeList[i].name === typeName) {
                    var panelType = this._dockPanelTypeList[i];

                    var panel = new (this.__getClass('wcPanel'))(this, typeName, panelType.options);
                    panel.__container(this.$transition);
                    var panelOptions = (panelType.options && panelType.options.options) || {};
                    panel._panelObject = new panelType.options.onCreate(panel, panelOptions, arg);

                    __addPanel.call(this, panel);
                    return panel;
                }
            }
            return false;
        },

        /**
         * Removes a docked panel from the window.
         * @function module:wcDocker#removePanel
         * @param {module:wcPanel} panel - The panel to remove.
         * @param {Boolean} dontDestroy - If true, the panel itself will not be destroyed.
         * @returns {Boolean} - Success or failure.
         */
        removePanel: function (panel, dontDestroy) {
            if (!panel) {
                return false;
            }

            // Do not remove if this is the last moveable panel.
            var lastPanel = this.__isLastPanel(panel);

            var parentFrame = panel._parent;
            if (parentFrame && parentFrame.instanceOf('wcFrame')) {
                // Trigger the closing event, if any explicitely returned false, we cancel the close event.
                var results = panel.__trigger(wcDocker.EVENT.CLOSING);
                for (var i = 0; i < results.length; ++i) {
                    if (!results[i]) {
                        return false;
                    }
                }

                if (dontDestroy) {
                    // Keep the panel in a hidden transition container so as to not
                    // destroy any event handlers that may be on it.
                    panel.__container(this.$transition);
                    panel._parent = null;
                } else {
                    panel.__trigger(wcDocker.EVENT.CLOSED);
                }

                // If no more panels remain in this frame, remove the frame.
                if (!parentFrame.removePanel(panel) && !parentFrame.isCollapser()) {
                    // If this is the last frame, create a dummy panel to take up
                    // the space until another one is created.
                    if (lastPanel) {
                        this.__addPlaceholder(parentFrame, this._options.placeholderHtml);

                        if (!dontDestroy) {
                            panel.__destroy();
                        } else {
                            panel.__trigger(wcDocker.EVENT.PERSISTENT_CLOSED);
                        }
                        return true;
                    }

                    var index = this._floatingList.indexOf(parentFrame);
                    if (index !== -1) {
                        this._floatingList.splice(index, 1);
                    }
                    index = this._frameList.indexOf(parentFrame);
                    if (index !== -1) {
                        this._frameList.splice(index, 1);
                    }
                    index = this._modalList.indexOf(parentFrame);
                    if (index !== -1) {
                        this._modalList.splice(index, 1);
                    }

                    if (this._modalList.length) {
                        this.__focus(this._modalList[this._modalList.length - 1]);
                    } else if (this._floatingList.length) {
                        this.__focus(this._floatingList[this._floatingList.length - 1]);
                    }

                    var parentSplitter = parentFrame._parent;
                    if (parentSplitter && parentSplitter.instanceOf('wcSplitter')) {
                        parentSplitter.__removeChild(parentFrame);

                        var other;
                        if (parentSplitter.pane(0)) {
                            other = parentSplitter.pane(0);
                            parentSplitter._pane[0] = null;
                        } else {
                            other = parentSplitter.pane(1);
                            parentSplitter._pane[1] = null;
                        }

                        // Keep the panel in a hidden transition container so as to not
                        // destroy any event handlers that may be on it.
                        other.__container(this.$transition);
                        other._parent = null;

                        index = this._splitterList.indexOf(parentSplitter);
                        if (index !== -1) {
                            this._splitterList.splice(index, 1);
                        }

                        var parent = parentSplitter._parent;
                        parentContainer = parentSplitter.__container();
                        parentSplitter.__destroy();

                        if (parent && parent.instanceOf('wcSplitter')) {
                            parent.__removeChild(parentSplitter);
                            if (!parent.pane(0)) {
                                parent.pane(0, other);
                            } else {
                                parent.pane(1, other);
                            }
                        } else if (parent === this) {
                            this._root = other;
                            other._parent = this;
                            other.__container(parentContainer);
                        }
                        this.__update();
                    } else if (parentFrame === this._root) {
                        this._root = null;
                    }

                    if (this._focusFrame === parentFrame) {
                        this._focusFrame = null;
                    }

                    parentFrame.__destroy();
                }

                if (!dontDestroy) {
                    panel.__destroy();
                } else {
                    panel.__trigger(wcDocker.EVENT.PERSISTENT_CLOSED);
                }
                return true;
            }
            return false;
        },

        /**
         * Moves a docking panel from its current location to another.
         * @function module:wcDocker#movePanel
         * @param {module:wcPanel} panel - The panel to move.
         * @param {module:wcDocker.DOCK} location - The new docking location of the panel.
         * @param {module:wcPanel|wcDocker.COLLAPSED} [targetPanel] - A target panel to dock relative to, or use {@link wcDocker.COLLAPSED} to collapse it to the side or bottom.
         * @param {module:wcDocker~PanelOptions} [options] - Other options for panel placement.
         * @returns {module:wcPanel|Boolean} - The panel that was created, or false on failure.
         */
        movePanel: function (panel, location, targetPanel, options) {
            var lastPanel = this.__isLastPanel(panel);

            var $elem = panel.$container;
            if (panel._parent && panel._parent.instanceOf('wcFrame')) {
                $elem = panel._parent.$frame;
            }
            var offset = $elem.offset();
            var width = $elem.width();
            var height = $elem.height();

            var parentFrame = panel._parent;
            var floating = false;
            if (parentFrame && parentFrame.instanceOf('wcFrame')) {
                floating = parentFrame._isFloating;
                // Remove the panel from the frame.
                for (var i = 0; i < parentFrame._panelList.length; ++i) {
                    if (parentFrame._panelList[i] === panel) {
                        if (parentFrame.isCollapser()) {
                            parentFrame._curTab = -1;
                        } else if (parentFrame._curTab >= i) {
                            parentFrame._curTab--;
                        }

                        // Keep the panel in a hidden transition container so as to not
                        // destroy any event handlers that may be on it.
                        panel.__container(this.$transition);
                        panel._parent = null;

                        parentFrame._panelList.splice(i, 1);
                        break;
                    }
                }

                if (!parentFrame.isCollapser() && parentFrame._curTab === -1 && parentFrame._panelList.length) {
                    parentFrame._curTab = 0;
                }

                parentFrame.__updateTabs();
                parentFrame.collapse();

                // If no more panels remain in this frame, remove the frame.
                if (!parentFrame.isCollapser() && parentFrame._panelList.length === 0) {
                    // If this is the last frame, create a dummy panel to take up
                    // the space until another one is created.
                    if (lastPanel) {
                        this.__addPlaceholder(parentFrame, this._options.placeholderHtml);
                    } else {
                        var index = this._floatingList.indexOf(parentFrame);
                        if (index !== -1) {
                            this._floatingList.splice(index, 1);
                        }
                        index = this._frameList.indexOf(parentFrame);
                        if (index !== -1) {
                            this._frameList.splice(index, 1);
                        }

                        var parentSplitter = parentFrame._parent;
                        if (parentSplitter && parentSplitter.instanceOf('wcSplitter')) {
                            parentSplitter.__removeChild(parentFrame);

                            var other;
                            if (parentSplitter.pane(0)) {
                                other = parentSplitter.pane(0);
                                parentSplitter._pane[0] = null;
                            } else {
                                other = parentSplitter.pane(1);
                                parentSplitter._pane[1] = null;
                            }

                            if (targetPanel === parentSplitter) {
                                targetPanel._shift = other;
                            }

                            // Keep the item in a hidden transition container so as to not
                            // destroy any event handlers that may be on it.
                            other.__container(this.$transition);
                            other._parent = null;

                            index = this._splitterList.indexOf(parentSplitter);
                            if (index !== -1) {
                                this._splitterList.splice(index, 1);
                            }

                            var parent = parentSplitter._parent;
                            parentContainer = parentSplitter.__container();
                            parentSplitter.__destroy();

                            if (parent && parent.instanceOf('wcSplitter')) {
                                parent.__removeChild(parentSplitter);
                                if (!parent.pane(0)) {
                                    parent.pane(0, other);
                                } else {
                                    parent.pane(1, other);
                                }
                            } else if (parent === this) {
                                this._root = other;
                                other._parent = this;
                                other.__container(parentContainer);
                            }
                            this.__update();
                        }

                        if (this._focusFrame === parentFrame) {
                            this._focusFrame = null;
                        }

                        parentFrame.__destroy();
                    }
                }
            }

            panel.initSize(width, height);
            if (location === wcDocker.DOCK.STACKED) {
                this.__addPanelGrouped(panel, targetPanel, options);
            } else {
                this.__addPanelAlone(panel, location, targetPanel, options);
            }

            if (targetPanel == this._placeholderPanel) {
                this.removePanel(this._placeholderPanel);
                this._placeholderPanel = null;
            }

            var frame = panel._parent;
            if (frame && frame.instanceOf('wcFrame')) {
                if (frame._panelList.length === 1) {
                    frame.pos(offset.left + width / 2 + 20, offset.top + height / 2 + 20, true);
                }
            }

            this.__update(true);

            if (frame && frame.instanceOf('wcFrame')) {
                if (floating !== frame._isFloating) {
                    if (frame._isFloating) {
                        panel.__trigger(wcDocker.EVENT.DETACHED);
                    } else {
                        panel.__trigger(wcDocker.EVENT.ATTACHED);
                    }
                }
            }

            panel.__trigger(wcDocker.EVENT.MOVED);
            return panel;
        },

        /**
         * Finds all instances of a given panel type.
         * @function module:wcDocker#findPanels
         * @param {String} [typeName] - The name identifier for the panel. If not supplied, all panels are retrieved.
         * @returns {module:wcPanel[]} - A list of all panels found of the given type.
         */
        findPanels: function (typeName) {
            var result = [];
            for (var i = 0; i < this._frameList.length; ++i) {
                var frame = this._frameList[i];
                for (var a = 0; a < frame._panelList.length; ++a) {
                    var panel = frame._panelList[a];
                    if (!typeName || panel._type === typeName) {
                        result.push(panel);
                    }
                }
            }

            return result;
        },

        /**
         * Shows the loading screen.
         * @function module:wcDocker#startLoading
         * @param {String} [label] - An optional label to display.
         * @param {Number} [opacity=0.4] - If supplied, assigns a custom opacity value to the loading screen.
         * @param {Number} [textOpacity=1] - If supplied, assigns a custom opacity value to the loading icon and text displayed.
         */
        startLoading: function (label, opacity, textOpacity) {
            if (!this.$loading) {
                this.$loading = $('<div class="wcLoadingContainer"></div>');
                this.$outer.append(this.$loading);

                var $background = $('<div class="wcLoadingBackground"></div>');
                if (typeof opacity !== 'number') {
                    opacity = 0.4;
                }

                $background.css('opacity', opacity);
                this.$loading.append($background);

                var $icon = $('<div class="wcLoadingIconContainer"><i class="wcLoadingIcon ' + this._options.loadingClass + '"></i></div>');
                this.$loading.append($icon);

                if (label) {
                    var $label = $('<span class="wcLoadingLabel">' + label + '</span>');
                    this.$loading.append($label);
                }

                if (typeof textOpacity !== 'number') {
                    textOpacity = 1;
                }

                $icon.css('opacity', textOpacity);

                if ($label) {
                    $label.css('opacity', textOpacity);
                }
            }
        },

        /**
         * Hides the loading screen.
         * @function module:wcDocker#finishLoading
         * @param {Number} [fadeDuration=0] - The fade out duration for the loading screen.
         */
        finishLoading: function (fadeDuration) {
            if (this.$loading) {
                if (fadeDuration > 0) {
                    var self = this;
                    this.$loading.fadeOut(fadeDuration, function () {
                        self.$loading.remove();
                        self.$loading = null;
                    });
                } else {
                    this.$loading.remove();
                    this.$loading = null;
                }
            }
        },

        /**
         * Registers a global [event]{@link wcDocker.EVENT}.
         * @function module:wcDocker#on
         * @param {module:wcDocker.EVENT} eventType        - The event type, can be a custom event string or a [predefined event]{@link wcDocker.EVENT}.
         * @param {module:wcDocker~event:onEvent} handler  - A handler function to be called for the event.
         * @returns {Boolean} Success or failure that the event has been registered.
         */
        on: function (eventType, handler) {
            if (!eventType) {
                return false;
            }

            if (!this._events[eventType]) {
                this._events[eventType] = [];
            }

            if (this._events[eventType].indexOf(handler) !== -1) {
                return false;
            }

            this._events[eventType].push(handler);
            return true;
        },

        /**
         * Unregisters a global [event]{@link wcDocker.EVENT}.
         * @function module:wcDocker#off
         * @param {module:wcDocker.EVENT} eventType          - The event type, can be a custom event string or a [predefined event]{@link wcDocker.EVENT}.
         * @param {module:wcDocker~event:onEvent} [handler]  - The handler function registered with the event. If omitted, all events registered to the event type are unregistered.
         */
        off: function (eventType, handler) {
            if (typeof eventType === 'undefined') {
                this._events = {};
            } else {
                if (this._events[eventType]) {
                    if (typeof handler === 'undefined') {
                        this._events[eventType] = [];
                    } else {
                        for (var i = 0; i < this._events[eventType].length; ++i) {
                            if (this._events[eventType][i] === handler) {
                                this._events[eventType].splice(i, 1);
                                break;
                            }
                        }
                    }
                }
            }
        },

        /**
         * Trigger an [event]{@link wcDocker.EVENT} on all panels.
         * @function module:wcDocker#trigger
         * @fires wcDocker~event:onEvent
         * @param {module:wcDocker.EVENT} eventType - The event type, can be a custom event string or a [predefined event]{@link wcDocker.EVENT}.
         * @param {Object} [data] - A custom data object to be passed along with the event.
         * @returns {Object[]} results - Returns an array with all results returned by event handlers.
         */
        trigger: function (eventName, data) {
            if (!eventName) {
                return false;
            }

            var results = [];

            for (var i = 0; i < this._frameList.length; ++i) {
                var frame = this._frameList[i];
                for (var a = 0; a < frame._panelList.length; ++a) {
                    var panel = frame._panelList[a];
                    results = results.concat(panel.__trigger(eventName, data));
                }
            }

            return results.concat(this.__trigger(eventName, data));
        },

        /**
         * Assigns a basic context menu to a selector element.  The context
         * Menu is a simple list of options, no nesting or special options.<br><br>
         *
         * If you wish to use a more complex context menu, you can use
         * [jQuery.contextMenu]{@link http://medialize.github.io/jQuery-contextMenu/docs.html} directly.
         * @function module:wcDocker#basicMenu
         * @deprecated Renamed to [wcDocker.menu}{@link wcDocker#menu}.
         * @param {external:jQuery~selector} selector                               - A selector string that designates the elements who use this menu.
         * @param {external:jQuery#contextMenu~item[]|Function} itemListOrBuildFunc - An array with each context menu item in it, or a function to call that returns one.
         * @param {Boolean} includeDefault                                          - If true, all default menu options will be included.
         */
        basicMenu: function (selector, itemListOrBuildFunc, includeDefault) {
            console.log('WARNING: wcDocker.basicMenu is deprecated, please use wcDocker.menu instead.');
            this.menu(selector, itemListOrBuildFunc, includeDefault);
        },

        /**
         * Assigns a basic context menu to a selector element.  The context
         * Menu is a simple list of options, no nesting or special options.<br><br>
         *
         * If you wish to use a more complex context menu, you can use
         * [jQuery.contextMenu]{@link http://medialize.github.io/jQuery-contextMenu/docs.html} directly.
         * @function module:wcDocker#menu
         * @param {external:jQuery~selector} selector                               - A selector string that designates the elements who use this menu.
         * @param {external:jQuery#contextMenu~item[]|Function} itemListOrBuildFunc - An array with each context menu item in it, or a function to call that returns one.
         * @param {Boolean} includeDefault                                          - If true, all default menu options will be included.
         */
        menu: function (selector, itemListOrBuildFunc, includeDefault) {
            var self = this;
            $.contextMenu({
                selector: selector,
                build: function ($trigger, event) {
                    var mouse = self.__mouse(event);
                    var myFrame;
                    for (var i = 0; i < self._frameList.length; ++i) {
                        var $frame = $trigger.hasClass('wcFrame') && $trigger || $trigger.parents('.wcFrame');
                        if (self._frameList[i].$frame[0] === $frame[0]) {
                            myFrame = self._frameList[i];
                            break;
                        }
                    }

                    var isTitle = false;
                    if ($(event.target).hasClass('wcTabScroller')) {
                        isTitle = true;
                    }

                    var windowTypes = {};
                    for (var i = 0; i < self._dockPanelTypeList.length; ++i) {
                        var type = self._dockPanelTypeList[i];
                        if (!type.options.isPrivate) {
                            if (type.options.limit > 0) {
                                if (self.findPanels(type.name).length >= type.options.limit) {
                                    continue;
                                }
                            }
                            var icon = null;
                            var faicon = null;
                            var label = type.name;
                            if (type.options) {
                                if (type.options.faicon) {
                                    faicon = type.options.faicon;
                                }
                                if (type.options.icon) {
                                    icon = type.options.icon;
                                }
                                if (type.options.title) {
                                    label = type.options.title;
                                }
                            }
                            windowTypes[type.name] = {
                                name: label,
                                icon: icon,
                                faicon: faicon,
                                className: 'wcMenuCreatePanel'
                            };
                        }
                    }

                    var separatorIndex = 0;
                    var finalItems = {};
                    var itemList = itemListOrBuildFunc;
                    if (typeof itemListOrBuildFunc === 'function') {
                        itemList = itemListOrBuildFunc($trigger, event);
                    }

                    for (var i = 0; i < itemList.length; ++i) {
                        if ($.isEmptyObject(itemList[i])) {
                            finalItems['sep' + separatorIndex++] = "---------";
                            continue;
                        }

                        var callback = itemList[i].callback;
                        if (callback) {
                            (function (listItem, callback) {
                                listItem.callback = function (key, opts) {
                                    var panel = null;
                                    var $frame = opts.$trigger.parents('.wcFrame').first();
                                    if ($frame.length) {
                                        for (var a = 0; a < self._frameList.length; ++a) {
                                            if ($frame[0] === self._frameList[a].$frame[0]) {
                                                panel = self._frameList[a].panel();
                                            }
                                        }
                                    }

                                    callback(key, opts, panel);
                                };
                            })(itemList[i], callback);
                        }
                        finalItems[itemList[i].name] = itemList[i];
                    }

                    var collapseTypes = {};
                    var defaultCollapse = '';
                    if (self.isCollapseEnabled()) {

                        var $icon = myFrame.$collapse.children('div');
                        if ($icon.hasClass('wcCollapseLeft')) {
                            defaultCollapse = ' wcCollapseLeft';
                        } else if ($icon.hasClass('wcCollapseRight')) {
                            defaultCollapse = ' wcCollapseRight';
                        } else {
                            defaultCollapse = ' wcCollapseBottom';
                        }

                        collapseTypes[wcDocker.DOCK.LEFT] = {
                            name: wcDocker.DOCK.LEFT,
                            faicon: 'sign-in wcCollapseLeft wcCollapsible'
                        };
                        collapseTypes[wcDocker.DOCK.RIGHT] = {
                            name: wcDocker.DOCK.RIGHT,
                            faicon: 'sign-in wcCollapseRight wcCollapsible'
                        };
                        collapseTypes[wcDocker.DOCK.BOTTOM] = {
                            name: wcDocker.DOCK.BOTTOM,
                            faicon: 'sign-in wcCollapseBottom wcCollapsible'
                        };
                    }

                    var items = finalItems;

                    if (includeDefault) {
                        if (!$.isEmptyObject(finalItems)) {
                            items['sep' + separatorIndex++] = "---------";
                        }

                        if (isTitle) {
                            items['Close Panel'] = {
                                name: 'Remove Panel',
                                faicon: 'close',
                                disabled: !myFrame.panel().closeable()
                            };
                            if (self.isCollapseEnabled()) {
                                if (!myFrame.isCollapser()) {
                                    items.fold1 = {
                                        name: 'Collapse Panel',
                                        faicon: 'sign-in' + defaultCollapse + ' wcCollapsible',
                                        items: collapseTypes,
                                        disabled: !myFrame.panel().moveable()
                                    }
                                } else {
                                    items['Attach Panel'] = {
                                        name: 'Dock Panel',
                                        faicon: 'sign-out' + defaultCollapse + ' wcCollapsed',
                                        disabled: !myFrame.panel().moveable()
                                    }
                                }
                            }
                            if (!myFrame._isFloating && myFrame.panel().detachable() || !myFrame.panel()._isPlaceholder) {
                                items['Detach Panel'] = {
                                    name: 'Detach Panel',
                                    faicon: 'level-up',
                                    disabled: !myFrame.panel().moveable() || !myFrame.panel().detachable() || myFrame.panel()._isPlaceholder
                                };
                            }

                            items['sep' + separatorIndex++] = "---------";

                            items.fold2 = {
                                name: 'Add Panel',
                                faicon: 'columns',
                                items: windowTypes,
                                disabled: !(myFrame.panel()._titleVisible && (!myFrame._isFloating || self._modalList.indexOf(myFrame) === -1)),
                                className: 'wcMenuCreatePanel'
                            };
                        } else {
                            if (myFrame) {
                                if (!myFrame.panel()._isPlaceholder) {
                                    items['Close Panel'] = {
                                        name: 'Remove Panel',
                                        faicon: 'close',
                                        disabled: !myFrame.panel().closeable()
                                    };
                                }
                                if (self.isCollapseEnabled()) {
                                    if (!myFrame.isCollapser()) {
                                        items.fold1 = {
                                            name: 'Collapse Panel',
                                            faicon: 'sign-in' + defaultCollapse + ' wcCollapsible',
                                            items: collapseTypes,
                                            disabled: !myFrame.panel().moveable()
                                        }
                                    } else {
                                        items['Attach Panel'] = {
                                            name: 'Dock Panel',
                                            faicon: 'sign-out' + defaultCollapse + ' wcCollapsed',
                                            disabled: !myFrame.panel().moveable()
                                        }
                                    }
                                }
                                if (!myFrame._isFloating && myFrame.panel().detachable() || !myFrame.panel()._isPlaceholder) {
                                    items['Detach Panel'] = {
                                        name: 'Detach Panel',
                                        faicon: 'level-up',
                                        disabled: !myFrame.panel().moveable() || !myFrame.panel().detachable() || myFrame.panel()._isPlaceholder
                                    };
                                }

                                items['sep' + separatorIndex++] = "---------";
                            }

                            items.fold2 = {
                                name: 'Add Panel',
                                faicon: 'columns',
                                items: windowTypes,
                                disabled: !(!myFrame || (!myFrame._isFloating && myFrame.panel().moveable())),
                                className: 'wcMenuCreatePanel'
                            };
                        }

                        if (myFrame && !myFrame._isFloating && myFrame.panel().moveable()) {
                            var rect = myFrame.__rect();
                            self._ghost = new (self.__getClass('wcGhost'))(rect, mouse, self);
                            myFrame.__checkAnchorDrop(mouse, false, self._ghost, true, false, false);
                            self._ghost.$ghost.hide();
                        }
                    }

                    return {
                        callback: function (key, options) {
                            if (key === 'Close Panel') {
                                setTimeout(function () {
                                    myFrame.panel().close();
                                }, 10);
                            } else if (key === 'Detach Panel') {
                                self.movePanel(myFrame.panel(), wcDocker.DOCK.FLOAT, false);
                            } else if (key === 'Attach Panel') {
                                var $icon = myFrame.$collapse.children('div');
                                var position = wcDocker.DOCK.BOTTOM;
                                if ($icon.hasClass('wcCollapseLeft')) {
                                    position = wcDocker.DOCK.LEFT;
                                } else if ($icon.hasClass('wcCollapseRight')) {
                                    position = wcDocker.DOCK.RIGHT;
                                }
                                var opts = {};
                                switch (position) {
                                    case wcDocker.DOCK.LEFT:
                                        opts.w = myFrame.$frame.width();
                                        break;
                                    case wcDocker.DOCK.RIGHT:
                                        opts.w = myFrame.$frame.width();
                                        break;
                                    case wcDocker.DOCK.BOTTOM:
                                        opts.h = myFrame.$frame.height();
                                        break;
                                }
                                var target = self._collapser[wcDocker.DOCK.LEFT]._parent.right();
                                myFrame.collapse(true);
                                self.movePanel(myFrame.panel(), position, target, opts);
                            } else if (key === wcDocker.DOCK.LEFT) {
                                self.movePanel(myFrame.panel(), wcDocker.DOCK.LEFT, wcDocker.COLLAPSED);
                            } else if (key === wcDocker.DOCK.RIGHT) {
                                self.movePanel(myFrame.panel(), wcDocker.DOCK.RIGHT, wcDocker.COLLAPSED);
                            } else if (key === wcDocker.DOCK.BOTTOM) {
                                self.movePanel(myFrame.panel(), wcDocker.DOCK.BOTTOM, wcDocker.COLLAPSED);
                            } else {
                                if (self._ghost && (myFrame)) {
                                    var anchor = self._ghost.anchor();
                                    var target = myFrame.panel();
                                    if (anchor.item) {
                                        target = anchor.item._parent;
                                    }
                                    var newPanel = self.addPanel(key, anchor.loc, target, self._ghost.rect());
                                    newPanel.focus();
                                }
                            }
                        },
                        events: {
                            show: function (opt) {
                                (function (items) {

                                    // Whenever them menu is shown, we update and add the faicons.
                                    // Grab all those menu items, and propogate a list with them.
                                    var menuItems = {};
                                    var options = opt.$menu.find('.context-menu-item');
                                    for (var i = 0; i < options.length; ++i) {
                                        var $option = $(options[i]);
                                        var $span = $option.find('span');
                                        if ($span.length) {
                                            menuItems[$span[0].innerHTML] = $option;
                                        }
                                    }

                                    // function calls itself so that we get nice icons inside of menus as well.
                                    (function recursiveIconAdd(items) {
                                        for (var it in items) {
                                            var item = items[it];
                                            var $menu = menuItems[item.name];

                                            if ($menu) {
                                                var $icon = $('<div class="wcMenuIcon">');
                                                $menu.prepend($icon);

                                                if (item.icon) {
                                                    $icon.addClass(item.icon);
                                                }

                                                if (item.faicon) {
                                                    $icon.addClass('fa fa-menu fa-' + item.faicon + ' fa-lg fa-fw');
                                                }

                                                // Custom submenu arrow.
                                                if ($menu.hasClass('context-menu-submenu')) {
                                                    var $expander = $('<div class="wcMenuSubMenu fa fa-caret-right fa-lg">');
                                                    $menu.append($expander);
                                                }
                                            }

                                            // Iterate through sub-menus.
                                            if (item.items) {
                                                recursiveIconAdd(item.items);
                                            }
                                        }
                                    })(items);

                                })(items);
                            },
                            hide: function (opt) {
                                if (self._ghost) {
                                    self._ghost.destroy();
                                    self._ghost = false;
                                }
                            }
                        },
                        animation: {duration: 250, show: 'fadeIn', hide: 'fadeOut'},
                        reposition: false,
                        autoHide: true,
                        zIndex: 200,
                        items: items
                    };
                }
            });
        },

        /**
         * Bypasses the next context menu event.
         * Use this during a mouse up event in which you do not want the
         * context menu to appear when it normally would have.
         * @function module:wcDocker#bypassMenu
         */
        bypassMenu: function () {
            if (this._menuTimer) {
                clearTimeout(this._menuTimer);
            }

            for (var i in $.contextMenu.menus) {
                var menuSelector = $.contextMenu.menus[i].selector;
                $(menuSelector).contextMenu(false);
            }

            var self = this;
            this._menuTimer = setTimeout(function () {
                for (var i in $.contextMenu.menus) {
                    var menuSelector = $.contextMenu.menus[i].selector;
                    $(menuSelector).contextMenu(true);
                }
                self._menuTimer = null;
            }, 0);
        },

        /**
         * Saves the current panel configuration into a serialized
         * string that can be used later to restore it.
         * @function module:wcDocker#save
         * @returns {String} - A serialized string that describes the current panel configuration.
         */
        save: function () {
            var data = {};

            data.floating = [];
            for (var i = 0; i < this._floatingList.length; ++i) {
                data.floating.push(this._floatingList[i].__save());
            }

            data.root = this._root.__save();

            if (!$.isEmptyObject(this._collapser)) {
                data.collapsers = {
                    left: this._collapser[wcDocker.DOCK.LEFT].__save(),
                    right: this._collapser[wcDocker.DOCK.RIGHT].__save(),
                    bottom: this._collapser[wcDocker.DOCK.BOTTOM].__save()
                };
            }

            return JSON.stringify(data, function (key, value) {
                if (value == Infinity) {
                    return "Infinity";
                }
                return value;
            });
        },

        /**
         * Restores a previously saved configuration.
         * @function module:wcDocker#restore
         * @param {String} dataString - A previously saved serialized string, See [wcDocker.save]{@link wcDocker#save}.
         */
        restore: function (dataString) {
            var data = JSON.parse(dataString, function (key, value) {
                if (value === 'Infinity') {
                    return Infinity;
                }
                return value;
            });

            this.clear();

            this._root = this.__create(data.root, this, this.$container);
            this._root.__restore(data.root, this);

            for (var i = 0; i < data.floating.length; ++i) {
                var panel = this.__create(data.floating[i], this, this.$container);
                panel.__restore(data.floating[i], this);
            }

            this.__forceUpdate(false);

            if (!$.isEmptyObject(data.collapsers) && this.isCollapseEnabled()) {
                this.__initCollapsers();

                this._collapser[wcDocker.DOCK.LEFT].__restore(data.collapsers.left, this);
                this._collapser[wcDocker.DOCK.RIGHT].__restore(data.collapsers.right, this);
                this._collapser[wcDocker.DOCK.BOTTOM].__restore(data.collapsers.bottom, this);

                var self = this;
                setTimeout(function () {
                    self.__forceUpdate();
                });
            }
        },

        /**
         * Clears all contents from the docker instance.
         * @function module:wcDocker#clear
         */
        clear: function () {
            this._root = null;

            // Make sure we notify all panels that they are closing.
            this.trigger(wcDocker.EVENT.CLOSED);

            for (var i = 0; i < this._splitterList.length; ++i) {
                this._splitterList[i].__destroy();
            }

            for (var i = 0; i < this._frameList.length; ++i) {
                this._frameList[i].__destroy();
            }

            if (!$.isEmptyObject(this._collapser)) {
                this._collapser[wcDocker.DOCK.LEFT].__destroy();
                this._collapser[wcDocker.DOCK.RIGHT].__destroy();
                this._collapser[wcDocker.DOCK.BOTTOM].__destroy();
                this._collapser = {};
            }

            while (this._frameList.length) this._frameList.pop();
            while (this._floatingList.length) this._floatingList.pop();
            while (this._splitterList.length) this._splitterList.pop();

            this.off();
        },


///////////////////////////////////////////////////////////////////////////////////////////////////////
// Private Functions
///////////////////////////////////////////////////////////////////////////////////////////////////////

        __init: function () {
            var self = this;

            this.__compatibilityCheck();

            this._root = null;
            this.__addPlaceholder(null, this._options.placeholderHtml);

            // Setup our context menus.
            if (this._options.allowContextMenu) {
                this.menu('.wcFrame', [], true);
            }

            this.theme(this._options.theme);

            // Set up our responsive updater.
            this._updateId = setInterval(function () {
                if (self._dirty) {
                    self._dirty = false;
                    if (self._root) {
                        self._root.__update(self._dirtyDontMove);
                    }

                    for (var i = 0; i < self._floatingList.length; ++i) {
                        self._floatingList[i].__update();
                    }
                }
            }, this._options.responseRate);

            $(window).resize(this.__resize.bind(this));
            // $('body').on('contextmenu', 'a, img', __onContextShowNormal);
            $('body').on('contextmenu', '.wcSplitterBar', __onContextDisable);

            // $('body').on('selectstart', '.wcFrameTitleBar, .wcPanelTab, .wcFrameButton', function(event) {
            //   event.preventDefault();
            // });

            // Hovering over a panel creation context menu.
            $('body').on('mouseenter', '.wcMenuCreatePanel', __onEnterCreatePanel);
            $('body').on('mouseleave', '.wcMenuCreatePanel', __onLeaveCreatePanel);

            // Mouse move will allow you to move an object that is being dragged.
            $('body').on('mousemove', __onMouseMove);
            $('body').on('touchmove', __onMouseMove);
            // A catch all on mouse down to record the mouse origin position.
            $('body').on('mousedown', __onMouseDown);
            $('body').on('touchstart', __onMouseDown);
            $('body').on('mousedown', '.wcModalBlocker', __onMouseDownModalBlocker);
            $('body').on('touchstart', '.wcModalBlocker', __onMouseDownModalBlocker);
            // On some browsers, clicking and dragging a tab will drag it's graphic around.
            // Here I am disabling this as it interferes with my own drag-drop.
            $('body').on('mousedown', '.wcPanelTab', __onPreventDefault);
            $('body').on('touchstart', '.wcPanelTab', __onPreventDefault);
            $('body').on('mousedown', '.wcFrameButtonBar > .wcFrameButton', __onMouseSelectionBlocker);
            $('body').on('touchstart', '.wcFrameButtonBar > .wcFrameButton', __onMouseSelectionBlocker);
            // Mouse down on a frame title will allow you to move them.
            $('body').on('mousedown', '.wcFrameTitleBar', __onMouseDownFrameTitle);
            $('body').on('touchstart', '.wcFrameTitleBar', __onMouseDownFrameTitle);
            // Mouse down on a splitter bar will allow you to resize them.
            $('body').on('mousedown', '.wcSplitterBar', __onMouseDownSplitter);
            $('body').on('touchstart', '.wcSplitterBar', __onMouseDownSplitter);
            // Middle mouse button on a panel tab to close it.
            $('body').on('mousedown', '.wcPanelTab', __onMouseDownPanelTab);
            $('body').on('touchstart', '.wcPanelTab', __onMouseDownPanelTab);
            // Middle mouse button on a panel tab to close it.
            $('body').on('mouseup', '.wcPanelTab', __onReleasePanelTab);
            $('body').on('touchend', '.wcPanelTab', __onReleasePanelTab);
            // Mouse down on a panel will put it into focus.
            $('body').on('mousedown', '.wcLayout', __onMouseDownLayout);
            $('body').on('touchstart', '.wcLayout', __onMouseDownLayout);
            // Floating frames have resizable edges.
            $('body').on('mousedown', '.wcFrameEdge', __onMouseDownResizeFrame);
            $('body').on('touchstart', '.wcFrameEdge', __onMouseDownResizeFrame);
            // Create new panels.
            $('body').on('mousedown', '.wcCreatePanel', __onMouseDownCreatePanel);
            $('body').on('touchstart', '.wcCreatePanel', __onMouseDownCreatePanel);
            // Cancell panel creation.
            $('body').on('mouseup', '.wcCreatePanel', __onMouseUpCancelCreatePanel);
            $('body').on('touchend', '.wcCreatePanel', __onMouseUpCancelCreatePanel);
            // Mouse released
            $('body').on('mouseup', __onMouseUp);
            $('body').on('touchend', __onMouseUp);

            // Clicking on a custom tab button.
            $('body').on('click', '.wcCustomTab .wcFrameButton', __onClickCustomTabButton);
            // Clicking on a panel frame button.
            $('body').on('click', '.wcFrameButtonBar > .wcFrameButton', __onClickPanelButton);

            // Escape key to cancel drag operations.
            $('body').on('keyup', __onKeyup);

            $('body').on('touchstart', '.wcFrame', __onFrameTouchStart);
            $('body').on('touchend', '.wcFrame', __onFrameTouchEnd);

            function __onFrameTouchEnd(event) {
                if (self._contextTimer) {
                    clearTimeout(self._contextTimer);
                    self._contextTimer = null;
                }
                return true;
            }

            function __onFrameTouchStart(event) {
                if (event.target.classList.contains('wcTabScroller') || event.target.classList.contains('fa') || event.target.classList.contains('wcFrameButtonBar') || event.target.classList.contains('wcFrameTitle') ) { return true; }
                if (event.stopPropagation) event.stopPropagation();
                if (event.preventDefault) event.preventDefault();
                event.cancelBubble = true;
                event.returnValue = false;


                self._contextTimer = setTimeout(function() {
                    self._contextTimer = null;
                    $(event.currentTarget).contextMenu({x: event.pageX, y: event.pageY});
                }.bind(this), 500);
            }

            // on mousedown
            function __onMouseDown(event) {
                var mouse = self.__mouse(event);
                self._mouseOrigin.x = mouse.x;
                self._mouseOrigin.y = mouse.y;
            }

            // on mouseup
            function __onMouseUp(event) {
                var mouse = self.__mouse(event);
                if (mouse.which === 3) {
                    return true;
                }
                $('body').removeClass('wcDisableSelection');
                if (self._draggingFrame) {
                    for (var i = 0; i < self._frameList.length; ++i) {
                        self._frameList[i].__shadow(false);
                    }
                }

                if (self._ghost && (self._draggingFrame || self._creatingPanel)) {
                    var anchor = self._ghost.anchor();

                    if (self._draggingFrame) {
                        if (!anchor) {
                            if (!self._draggingFrameTab) {
                                self._draggingFrame.panel(0);
                            }

                            var panel = self._draggingFrame.panel(parseInt($(self._draggingFrameTab).attr('id')));
                            self.movePanel(panel, wcDocker.DOCK.FLOAT, null, self._ghost.__rect());
                            // Dragging the entire frame.
                            if (!self._draggingFrameTab) {
                                var count = self._draggingFrame._panelList.length;
                                if (count > 1 || self._draggingFrame.panel() !== self._placeholderPanel) {
                                    for (var i = 0; i < count; ++i) {
                                        self.movePanel(self._draggingFrame.panel(), wcDocker.DOCK.STACKED, panel, {tabOrientation: self._draggingFrame._tabOrientation});
                                    }
                                }
                            }

                            var frame = panel._parent;
                            if (frame && frame.instanceOf('wcFrame')) {
                                frame.pos(mouse.x, mouse.y + self._ghost.__rect().h / 2 - 10, true);

                                frame._size.x = self._ghost.__rect().w;
                                frame._size.y = self._ghost.__rect().h;
                            }

                            frame.__update();
                            self.__focus(frame);
                        } else if (!anchor.self && anchor.loc !== undefined) {
                            // Changing tab location on the same frame.
                            if (anchor.tab && anchor.item._parent._parent == self._draggingFrame) {
                                self._draggingFrame.tabOrientation(anchor.tab);
                            } else {
                                var index = 0;
                                if (self._draggingFrameTab) {
                                    index = parseInt($(self._draggingFrameTab).attr('id'));
                                } else {
                                    self._draggingFrame.panel(0);
                                }
                                var panel;
                                if (anchor.item) {
                                    panel = anchor.item._parent;
                                }
                                // If we are dragging a tab to split its own container, find another
                                // tab item within the same frame and split from there.
                                if (self._draggingFrame._panelList.indexOf(panel) > -1) {
                                    // Can not split the frame if it is the only panel inside.
                                    if (self._draggingFrame._panelList.length === 1) {
                                        return;
                                    }
                                    for (var i = 0; i < self._draggingFrame._panelList.length; ++i) {
                                        if (panel !== self._draggingFrame._panelList[i]) {
                                            panel = self._draggingFrame._panelList[i];
                                            index--;
                                            break;
                                        }
                                    }
                                }
                                var movingPanel = null;
                                if (self._draggingFrameTab) {
                                    movingPanel = self._draggingFrame.panel(parseInt($(self._draggingFrameTab).attr('id')));
                                } else {
                                    movingPanel = self._draggingFrame.panel();
                                }
                                panel = self.movePanel(movingPanel, anchor.loc, panel, self._ghost.rect());
                                panel._parent.panel(panel._parent._panelList.length - 1, true);
                                // Dragging the entire frame.
                                if (!self._draggingFrameTab) {
                                    var rect = self._ghost.rect();
                                    if (!rect.tabOrientation) {
                                        rect.tabOrientation = self._draggingFrame.tabOrientation();
                                    }
                                    var count = self._draggingFrame._panelList.length;
                                    if (count > 1 || self._draggingFrame.panel() !== self._placeholderPanel) {
                                        for (var i = 0; i < count; ++i) {
                                            self.movePanel(self._draggingFrame.panel(), wcDocker.DOCK.STACKED, panel, rect);
                                        }
                                    }
                                } else {
                                    var frame = panel._parent;
                                    if (frame && frame.instanceOf('wcFrame')) {
                                        index = index + frame._panelList.length;
                                    }
                                }

                                var frame = panel._parent;
                                if (frame && frame.instanceOf('wcFrame')) {
                                    frame.panel(index);
                                }
                                self.__focus(frame);
                            }
                        }
                    } else if (self._creatingPanel) {
                        var loc = wcDocker.DOCK.FLOAT;
                        var target = null;
                        if (anchor) {
                            loc = anchor.loc;
                            if (anchor.item) {
                                target = anchor.item._parent;
                            } else {
                                target = anchor.panel;
                            }
                        }
                        self.addPanel(self._creatingPanel, loc, target, self._ghost.rect());
                    }

                    self._ghost.destroy();
                    self._ghost = null;

                    self.trigger(wcDocker.EVENT.END_DOCK);
                    self.__update();
                }

                if (self._draggingSplitter) {
                    self._draggingSplitter.$pane[0].removeClass('wcResizing');
                    self._draggingSplitter.$pane[1].removeClass('wcResizing');
                }

                self._creatingPanel = false;
                self._draggingSplitter = null;
                self._draggingFrame = null;
                self._draggingFrameSizer = null;
                self._draggingFrameTab = null;
                self._draggingFrameTopper = false;
                self._draggingCustomTabFrame = null;
                self._removingPanel = null;
                return true;
            }

            // on mousemove
            var lastMouseMove = new Date().getTime();
            var lastMouseEvent = null;
            var moveTimeout = 0;
            var lastLButtonDown = 0;

            function __onMouseMove(event) {
                lastMouseEvent = event;
                var mouse = self.__mouse(event);
                if (mouse.which === 3 || (
                    !self._draggingSplitter && !self._draggingFrameSizer && !self._draggingCustomTabFrame && !self._ghost && !self._draggingFrame && !self._draggingFrameTab)) {
                    return true;
                }

                var t = new Date().getTime();
                if (t - lastMouseMove < self._options.responseRate) {
                    if (!moveTimeout) {
                        moveTimeout = setTimeout(function () {
                            lastMouseMove = 0;
                            moveTimeout = 0;
                            __onMouseMove(lastMouseEvent);
                        }, self._options.responseRate);
                    }
                    return true;
                }
                lastMouseMove = new Date().getTime();

                if (self._draggingSplitter) {
                    self._draggingSplitter.__moveBar(mouse);
                } else if (self._draggingFrameSizer) {
                    var offset = self.$container.offset();
                    mouse.x += offset.left;
                    mouse.y += offset.top;

                    self._draggingFrame.__resize(self._draggingFrameSizer, mouse);
                    self._draggingFrame.__update();
                } else if (self._draggingCustomTabFrame) {
                    if (self._draggingCustomTabFrame.moveable()) {
                        var $hoverTab = $(event.target).hasClass('wcPanelTab') ? $(event.target) : $(event.target).parents('.wcPanelTab');
                        if (self._draggingFrameTab && $hoverTab && $hoverTab.length && self._draggingFrameTab !== event.target) {
                            self._draggingFrameTab = self._draggingCustomTabFrame.moveTab(parseInt($(self._draggingFrameTab).attr('id')), parseInt($hoverTab.attr('id')));
                        }
                    }
                } else if (self._ghost) {
                    if (self._draggingFrame) {
                        self._ghost.__move(mouse);
                        var forceFloat = !(self._draggingFrame._isFloating || mouse.which === 1);
                        var found = false;

                        // Check anchoring with self.
                        if (!self._draggingFrame.__checkAnchorDrop(mouse, true, self._ghost, self._draggingFrame._panelList.length > 1 && self._draggingFrameTab, self._draggingFrameTopper, !self.__isLastFrame(self._draggingFrame))) {
                            // Introduce a delay before a panel begins movement to a new docking position.
                            if (new Date().getTime() - lastLButtonDown < self._options.moveStartDelay) {
                                return;
                            }
                            self._draggingFrame.__shadow(true);
                            self.__focus();
                            if (!forceFloat) {
                                for (var i = 0; i < self._frameList.length; ++i) {
                                    if (self._frameList[i] !== self._draggingFrame) {
                                        if (self._frameList[i].__checkAnchorDrop(mouse, false, self._ghost, true, self._draggingFrameTopper, !self.__isLastFrame(self._draggingFrame))) {
                                            self._draggingFrame.__shadow(true);
                                            return;
                                        }
                                    }
                                }
                            }

                            if (self._draggingFrame.panel().detachable()) {
                                self._ghost.anchor(mouse, null);
                            }
                        } else {
                            self._draggingFrame.__shadow(false);
                            var $target = $(document.elementFromPoint(mouse.x, mouse.y));
                            var $hoverTab = $target.hasClass('wcPanelTab') ? $target : $target.parents('.wcPanelTab');
                            if (self._draggingFrameTab && $hoverTab.length && self._draggingFrameTab !== $hoverTab[0]) {
                                self._draggingFrameTab = self._draggingFrame.__tabMove(parseInt($(self._draggingFrameTab).attr('id')), parseInt($hoverTab.attr('id')));
                            }
                        }
                    } else if (self._creatingPanel) {
                        self._ghost.update(mouse, !self._creatingPanelNoFloating);
                    }
                } else if (self._draggingFrame && !self._draggingFrameTab) {
                    self._draggingFrame.__move(mouse);
                    self._draggingFrame.__update();
                }
                return true;
            }

            // on contextmenu for a, img
            function __onContextShowNormal() {
                if (self._contextTimer) {
                    clearTimeout(self._contextTimer);
                }

                $(".wcFrame").contextMenu(false);
                self._contextTimer = setTimeout(function () {
                    $(".wcFrame").contextMenu(true);
                    self._contextTimer = null;
                }, 100);
                return true;
            }

            // on contextmenu for .wcSplitterBar
            function __onContextDisable() {
                return false;
            }

            // on mouseenter for .wcMenuCreatePanel
            function __onEnterCreatePanel() {
                if (self._ghost) {
                    self._ghost.$ghost.stop().fadeIn(200);
                }
            }

            // on mouseleave for .wcMenuCreatePanel
            function __onLeaveCreatePanel() {
                if (self._ghost) {
                    self._ghost.$ghost.stop().fadeOut(200);
                }
            }

            // on mousedown for .wcModalBlocker
            function __onMouseDownModalBlocker(event) {
                // for (var i = 0; i < self._modalList.length; ++i) {
                //   self._modalList[i].__focus(true);
                // }
                if (self._modalList.length) {
                    self._modalList[self._modalList.length - 1].__focus(true);
                }
            }

            // on mousedown for .wcPanelTab
            function __onPreventDefault(event) {
                event.preventDefault();
                event.returnValue = false;
            }

            // on mousedown for .wcFrameButtonBar > .wcFrameButton
            function __onMouseSelectionBlocker() {
                $('body').addClass('wcDisableSelection');
            }

            // on click for .wcCustomTab .wcFrameButton
            function __onClickCustomTabButton(event) {
                $('body').removeClass('wcDisableSelection');
                for (var i = 0; i < self._tabList.length; ++i) {
                    var customTab = self._tabList[i];
                    if (customTab.$close[0] === this) {
                        var tabIndex = customTab.tab();
                        customTab.removeTab(tabIndex);
                        event.stopPropagation();
                        return;
                    }

                    if (customTab.$tabLeft[0] === this) {
                        customTab._tabScrollPos -= customTab.$tabBar.width() / 2;
                        if (customTab._tabScrollPos < 0) {
                            customTab._tabScrollPos = 0;
                        }
                        customTab.__updateTabs();
                        event.stopPropagation();
                        return;
                    }
                    if (customTab.$tabRight[0] === this) {
                        customTab._tabScrollPos += customTab.$tabBar.width() / 2;
                        customTab.__updateTabs();
                        event.stopPropagation();
                        return;
                    }
                }
            }

            // on click for .wcFrameButtonBar > .wcFrameButton
            function __onClickPanelButton() {
                $('body').removeClass('wcDisableSelection');
                for (var i = 0; i < self._frameList.length; ++i) {
                    var frame = self._frameList[i];
                    if (frame.$close[0] === this) {
                        self.__closePanel(frame.panel());
                        return;
                    }
                    if (frame.$collapse[0] === this) {
                        var $icon = frame.$collapse.children('div');
                        var position = wcDocker.DOCK.BOTTOM;
                        if ($icon.hasClass('wcCollapseLeft')) {
                            position = wcDocker.DOCK.LEFT;
                        } else if ($icon.hasClass('wcCollapseRight')) {
                            position = wcDocker.DOCK.RIGHT;
                        }
                        if (frame.isCollapser()) {
                            // Un-collapse
                            // var target;
                            var opts = {};
                            switch (position) {
                                case wcDocker.DOCK.LEFT:
                                    // target = frame._parent._parent.right();
                                    opts.w = frame.$frame.width();
                                    break;
                                case wcDocker.DOCK.RIGHT:
                                    // target = frame._parent._parent.left();
                                    opts.w = frame.$frame.width();
                                    break;
                                case wcDocker.DOCK.BOTTOM:
                                    // target = frame._parent._parent.top();
                                    opts.h = frame.$frame.height();
                                    break;
                            }
                            var target = self._collapser[wcDocker.DOCK.LEFT]._parent.right();
                            frame.collapse(true);
                            self.movePanel(frame.panel(), position, target, opts);
                        } else {
                            // collapse.
                            self.movePanel(frame.panel(), position, wcDocker.COLLAPSED);
                        }
                        self.__update();
                        return;
                    }
                    if (frame.$tabLeft[0] === this) {
                        frame._tabScrollPos -= frame.$tabBar.width() / 2;
                        if (frame._tabScrollPos < 0) {
                            frame._tabScrollPos = 0;
                        }
                        frame.__updateTabs();
                        return;
                    }
                    if (frame.$tabRight[0] === this) {
                        frame._tabScrollPos += frame.$tabBar.width() / 2;
                        frame.__updateTabs();
                        return;
                    }

                    for (var a = 0; a < frame._buttonList.length; ++a) {
                        if (frame._buttonList[a][0] === this) {
                            var $button = frame._buttonList[a];
                            var result = {
                                name: $button.data('name'),
                                isToggled: false
                            };

                            if ($button.hasClass('wcFrameButtonToggler')) {
                                $button.toggleClass('wcFrameButtonToggled');
                                if ($button.hasClass('wcFrameButtonToggled')) {
                                    result.isToggled = true;
                                }
                            }

                            var panel = frame.panel();
                            panel.buttonState(result.name, result.isToggled);
                            panel.__trigger(wcDocker.EVENT.BUTTON, result);
                            return;
                        }
                    }
                }
            }

            // on mouseup for .wcPanelTab
            function __onReleasePanelTab(event) {
                var mouse = self.__mouse(event);
                if (mouse.which !== 2) {
                    return;
                }

                var index = parseInt($(this).attr('id'));

                for (var i = 0; i < self._frameList.length; ++i) {
                    var frame = self._frameList[i];
                    if (frame.$tabBar[0] === $(this).parents('.wcFrameTitleBar')[0]) {
                        var panel = frame._panelList[index];
                        if (self._removingPanel === panel) {
                            self.removePanel(panel);
                            self.__update();
                        }
                        return;
                    }
                }
            }

            // on mousedown for .wcSplitterBar
            function __onMouseDownSplitter(event) {
                var mouse = self.__mouse(event);
                if (mouse.which !== 1) {
                    return true;
                }

                $('body').addClass('wcDisableSelection');
                for (var i = 0; i < self._splitterList.length; ++i) {
                    if (self._splitterList[i].$bar[0] === this) {
                        self._draggingSplitter = self._splitterList[i];
                        self._draggingSplitter.$pane[0].addClass('wcResizing');
                        self._draggingSplitter.$pane[1].addClass('wcResizing');
                        event.preventDefault();
                        break;
                    }
                }
                return true;
            }

            // on mousedown for .wcFrameTitleBar
            function __onMouseDownFrameTitle(event) {
                var mouse = self.__mouse(event);
                if (mouse.which === 3) {
                    return true;
                }
                // Skip frame buttons, they are handled elsewhere (Buttons may also have a child image or span so we check parent as well);
                if ($(event.target).hasClass('wcFrameButton') || $(event.target).parents('.wcFrameButton').length) {
                    return true;
                }

                lastLButtonDown = new Date().getTime();

                $('body').addClass('wcDisableSelection');
                for (var i = 0; i < self._frameList.length; ++i) {
                    if (self._frameList[i].$titleBar[0] == this ||
                        self._frameList[i].$tabBar[0] == this) {
                        self._draggingFrame = self._frameList[i];

                        self._draggingFrame.__anchorMove(mouse);

                        var $panelTab = $(event.target).hasClass('wcPanelTab') ? $(event.target) : $(event.target).parents('.wcPanelTab');
                        if ($panelTab && $panelTab.length) {
                            var index = parseInt($panelTab.attr('id'));
                            self._draggingFrame.panel(index, true);
                            self._draggingFrameTab = $panelTab[0];
                            $(window).focus();
                        }

                        // If the window is able to be docked, give it a dark shadow tint and begin the movement process
                        var shouldMove = true;
                        if (self._draggingFrameTab) {
                            if ($panelTab.hasClass('wcNotMoveable')) {
                                shouldMove = false;
                            }
                        } else {
                            if (self._draggingFrame._isFloating && mouse.which === 1) {
                                shouldMove = false;
                            }
                        }

                        // if (((!$panelTab.hasClass('wcNotMoveable') && self._draggingFrameTab) ||
                        //     !(self._draggingFrame.$titleBar.hasClass('wcNotMoveable') || self._draggingFrame.$tabBar.hasClass('wcNotMoveable'))) &&
                        //     (!self._draggingFrame._isFloating || mouse.which !== 1 || self._draggingFrameTab)) {
                        if (shouldMove) {
                            // Special case to allow users to drag out only a single collapsed tab even by dragging the title bar (which normally would drag out the entire frame).
                            if (!self._draggingFrameTab && self._draggingFrame.isCollapser()) {
                                self._draggingFrameTab = self._draggingFrame.panel();
                            }
                            self._draggingFrameTopper = $(event.target).parents('.wcFrameTopper').length > 0;
                            var rect = self._draggingFrame.__rect();
                            self._ghost = new (self.__getClass('wcGhost'))(rect, mouse, self);
                            self._draggingFrame.__checkAnchorDrop(mouse, true, self._ghost, true, self._draggingFrameTopper, !self.__isLastFrame(self._draggingFrame));
                            self.trigger(wcDocker.EVENT.BEGIN_DOCK);
                        }
                        break;
                    }
                }
                for (var i = 0; i < self._tabList.length; ++i) {
                    if (self._tabList[i].$tabBar[0] == this) {
                        self._draggingCustomTabFrame = self._tabList[i];

                        var $panelTab = $(event.target).hasClass('wcPanelTab') ? $(event.target) : $(event.target).parents('.wcPanelTab');
                        if ($panelTab && $panelTab.length) {
                            var index = parseInt($panelTab.attr('id'));
                            self._draggingCustomTabFrame.tab(index, true);
                            self._draggingFrameTab = $panelTab[0];
                        }
                        break;
                    }
                }
                if (self._draggingFrame) {
                    self.__focus(self._draggingFrame);
                }
                return true;
            }

            // on mousedown for .wcLayout
            function __onMouseDownLayout(event) {
                var mouse = self.__mouse(event);
                if (mouse.which === 3) {
                    return true;
                }
                for (var i = 0; i < self._frameList.length; ++i) {
                    if (self._frameList[i].panel() && self._frameList[i].panel().layout().scene()[0] == this) {
                        setTimeout(function () {
                            self.__focus(self._frameList[i]);
                        }, 10);
                        break;
                    }
                }
                return true;
            }

            // on mousedown for .wcFrameEdge
            function __onMouseDownResizeFrame(event) {
                var mouse = self.__mouse(event);
                if (mouse.which === 3) {
                    return true;
                }
                $('body').addClass('wcDisableSelection');
                for (var i = 0; i < self._frameList.length; ++i) {
                    if (self._frameList[i]._isFloating) {
                        if (self._frameList[i].$top[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['top'];
                            break;
                        } else if (self._frameList[i].$bottom[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['bottom'];
                            break;
                        } else if (self._frameList[i].$left[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['left'];
                            break;
                        } else if (self._frameList[i].$right[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['right'];
                            break;
                        } else if (self._frameList[i].$corner1[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['top', 'left'];
                            break;
                        } else if (self._frameList[i].$corner2[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['top', 'right'];
                            break;
                        } else if (self._frameList[i].$corner3[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['bottom', 'right'];
                            break;
                        } else if (self._frameList[i].$corner4[0] == this) {
                            self._draggingFrame = self._frameList[i];
                            self._draggingFrameSizer = ['bottom', 'left'];
                            break;
                        }
                    }
                }
                if (self._draggingFrame) {
                    self.__focus(self._draggingFrame);
                }
                return true;
            }

            // on mousedown for .wcCreatePanel
            function __onMouseDownCreatePanel(event) {
                if (event.stopPropagation) event.stopPropagation();
                if (event.preventDefault) event.preventDefault();
                event.cancelBubble = true;
                event.returnValue = false;

                var mouse = self.__mouse(event);
                if (mouse.which !== 1) {
                    return true;
                }

                self.__timeout = setTimeout(function() {
                    self.__timeout = null;
                    var panelType = $(this).data('panel');
                    var info = self.panelTypeInfo(panelType);
                    if (info) {
                        var rect = {
                            x: mouse.x - 250,
                            y: mouse.y,
                            w: 500,
                            h: 500
                        };
                        $('body').addClass('wcDisableSelection');
                        self._ghost = new (self.__getClass('wcGhost'))(rect, mouse, self);
                        self._ghost.update(mouse);
                        self._ghost.anchor(mouse, self._ghost.anchor());
                        self._creatingPanel = panelType;
                        self._creatingPanelNoFloating = !$(this).data('nofloating');
                        self.__focus();
                        self.trigger(wcDocker.EVENT.BEGIN_DOCK);
                    }
                }.bind(this), 200);
            }

            function __onMouseUpCancelCreatePanel(event) {
                if (self.__timeout) {
                    clearTimeout(self.__timeout);
                    self.__timeout = null;
                }
                return true;
            }

            // on mousedown for .wcPanelTab
            function __onMouseDownPanelTab(event) {
                var mouse = self.__mouse(event);
                if (mouse.which !== 2) {
                    return true;
                }

                var index = parseInt($(this).attr('id'));

                for (var i = 0; i < self._frameList.length; ++i) {
                    var frame = self._frameList[i];
                    if (frame.$tabBar[0] === $(this).parents('.wcFrameTitleBar')[0]) {
                        var panel = frame._panelList[index];
                        if (panel && panel.closeable()) {
                            self._removingPanel = frame._panelList[index];
                        }
                        return true;
                    }
                }
                return true;
            }

            // on keyup
            function __onKeyup(event) {
                if (event.keyCode == 27) {
                    if (self._ghost) {
                        self._ghost.destroy();
                        self._ghost = false;
                        self.trigger(wcDocker.EVENT.END_DOCK);

                        if (self._draggingFrame) {
                            self._draggingFrame.__shadow(false);
                        }
                        self._creatingPanel = false;
                        self._draggingSplitter = null;
                        self._draggingFrame = null;
                        self._draggingFrameSizer = null;
                        self._draggingFrameTab = null;
                        self._draggingFrameTopper = false;
                        self._draggingCustomTabFrame = null;
                        self._removingPanel = null;
                    }
                }
            }
        },

        // Test for load completion.
        __testLoadFinished: function () {
            for (var i = 0; i < this._frameList.length; ++i) {
                var frame = this._frameList[i];
                for (var a = 0; a < frame._panelList.length; ++a) {
                    var panel = frame._panelList[a];
                    // Skip if any panels are not initialized yet.
                    if (panel._isVisible && !panel._initialized) {
                        return;
                    }

                    // Skip if any panels still have a loading screen.
                    if (panel.$loading) {
                        return;
                    }
                }
            }

            // If we reach this point, all existing panels are initialized and loaded!
            var self = this;
            setTimeout(function() {
                self.trigger(wcDocker.EVENT.LOADED);

                // Now unregister all loaded events so they do not fire again.
                self.off(wcDocker.EVENT.LOADED);
                for (var i = 0; i < self._frameList.length; ++i) {
                    var frame = self._frameList[i];
                    for (var a = 0; a < frame._panelList.length; ++a) {
                        var panel = frame._panelList[a];
                        panel.off(wcDocker.EVENT.LOADED);
                    }
                }
            }, 0);
        },

        // Test for browser compatability issues.
        __compatibilityCheck: function () {
            // Provide backward compatibility for IE8 and other such older browsers.
            if (!Function.prototype.bind) {
                Function.prototype.bind = function (oThis) {
                    if (typeof this !== "function") {
                        // closest thing possible to the ECMAScript 5
                        // internal IsCallable function
                        throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
                    }

                    var aArgs = Array.prototype.slice.call(arguments, 1),
                        fToBind = this,
                        fNOP = function () {
                        },
                        fBound = function () {
                            return fToBind.apply(this instanceof fNOP && oThis
                                    ? this
                                    : oThis,
                                aArgs.concat(Array.prototype.slice.call(arguments)));
                        };

                    fNOP.prototype = this.prototype;
                    fBound.prototype = new fNOP();

                    return fBound;
                };
            }

            if (!Array.prototype.indexOf) {
                Array.prototype.indexOf = function (elt /*, from*/) {
                    var len = this.length >>> 0;

                    var from = Number(arguments[1]) || 0;
                    from = (from < 0)
                        ? Math.ceil(from)
                        : Math.floor(from);
                    if (from < 0)
                        from += len;

                    for (; from < len; from++) {
                        if (from in this &&
                            this[from] === elt)
                            return from;
                    }
                    return -1;
                };
            }

            // Check if the browser supports transformations. If not, we cannot rotate tabs or collapse panels.
            var ie = (function () {
                var v = 3;
                var div = document.createElement('div');
                var all = div.getElementsByTagName('i');
                while (
                    div.innerHTML = '<!--[if gt IE ' + (++v) + ']><i></i><![endif]-->',
                        all[0]
                    );
                return v > 4 ? v : undefined;
            }());

            if (ie < 9) {
                this._canOrientTabs = false;
            } else {
                function getSupportedTransform() {
                    var prefixes = 'transform WebkitTransform MozTransform OTransform msTransform'.split(' ');
                    var div = document.createElement('div');
                    for (var i = 0; i < prefixes.length; i++) {
                        if (div && div.style[prefixes[i]] !== undefined) {
                            return true;
                        }
                    }
                    return false;
                }

                this._canOrientTabs = getSupportedTransform();
            }

            // Check if we are running on a mobile device so we can alter themes accordingly.
            var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            $('body').addClass(isMobile ? "wcMobile" : "wcDesktop");
        },

        /*
         * Searches docked panels and splitters for a container that is within any static areas.
         */
        __findInner: function () {
            function isPaneStatic(pane) {
                return !!(pane && (pane.instanceOf('wcFrame') && pane.panel() && !pane.panel().moveable()) || (pane.instanceOf('wcCollapser')));
            }

            var parent = this._root;
            while (parent) {
                if (parent.instanceOf('wcSplitter')) {
                    var pane0 = isPaneStatic(parent._pane[0]);
                    var pane1 = isPaneStatic(parent._pane[1]);
                    if (pane0 && !pane1) {
                        parent = parent._pane[1];
                    } else if (pane1 && !pane0) {
                        parent = parent._pane[0];
                    } else if (!pane0 && !pane1) {
                        break;
                    }
                } else {
                    break;
                }
            }

            return parent;
        },

        /*
         * Sets up the collapsers for the panel.<br>
         * <b>Note: </b> This should be called AFTER you have initialized your panel layout, but BEFORE you add
         * any static panels that you do not wish to be overlapped by the collapsers (such as file menu panels).
         */
        __initCollapsers: function () {
            // Initialize collapsers if it is enabled and not already initialized.
            if (!this.isCollapseEnabled() || !$.isEmptyObject(this._collapser)) {
                return;
            }

            var parent = this.__findInner();

            function __createCollapser(location) {
                this._collapser[location] = this.__addCollapser(location, parent);
                parent = this._collapser[location]._parent;
                this._frameList.push(this._collapser[location]._drawer._frame);
            }

            __createCollapser.call(this, wcDocker.DOCK.LEFT);
            __createCollapser.call(this, wcDocker.DOCK.RIGHT);
            __createCollapser.call(this, wcDocker.DOCK.BOTTOM);

            var self = this;
            setTimeout(function () {
                self.__update();
            });
        },

        // Updates the sizing of all panels inside this window.
        __update: function (opt_dontMove) {
            this._dirty = true;
            this._dirtyDontMove = opt_dontMove;
        },

        // Forces an update, regardless of the response rate.
        __forceUpdate: function (opt_dontMove) {
            this._dirty = false;
            if (this._root) {
                this._root.__update(opt_dontMove);
            }

            for (var i = 0; i < this._floatingList.length; ++i) {
                this._floatingList[i].__update();
            }
        },

        __orderPanels: function () {
            if (this._floatingList.length === 0) {
                return;
            }

            var from = this._floatingList.indexOf(this._focusFrame);
            var to = this._floatingList.length - 1;

            this._floatingList.splice(to, 0, this._floatingList.splice(from, 1)[0]);

            var length = this._floatingList.length;
            var start = 10;
            var step = 5;
            var index = 0;
            var panel;

            for (var i = 0; i < this._floatingList.length; ++i) {
                panel = this._floatingList[i];
                if (panel) {
                    var layer = start + (i * step);
                    panel.$frame.css('z-index', layer);
                    panel.__trigger(wcDocker.EVENT.ORDER_CHANGED, layer);
                }
            }
        },

        // Retrieve mouse or touch position.
        __mouse: function (event) {
            if (event.originalEvent && (event.originalEvent.touches || event.originalEvent.changedTouches)) {
                var touch = event.originalEvent.touches[0] || event.originalEvent.changedTouches[0];
                return {
                    x: touch.clientX,
                    y: touch.clientY,
                    which: 1
                };
            }

            return {
                x: event.clientX || event.pageX,
                y: event.clientY || event.pageY,
                which: event.which || 1
            };
        },

        // On window resized event.
        __resize: function (event) {
            this._resizeData.time = new Date();
            if (!this._resizeData.timeout) {
                this._resizeData.timeout = true;
                setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
                this.__trigger(wcDocker.EVENT.RESIZE_STARTED);
            }
            this.__trigger(wcDocker.EVENT.RESIZED);
            this.__update(false);
        },

        // On window resize event ended.
        __resizeEnd: function () {
            if (new Date() - this._resizeData.time < this._resizeData.delta) {
                setTimeout(this.__resizeEnd.bind(this), this._resizeData.delta);
            } else {
                this._resizeData.timeout = false;
                this.__trigger(wcDocker.EVENT.RESIZE_ENDED);
            }
        },

        // Brings a floating window to the top.
        // Params:
        //    frame     The frame to focus.
        //    flash     Whether to flash the frame.
        __focus: function (frame, flash) {
            var differentFrames = this._focusFrame != frame;
            if (this._focusFrame) {
                if (this._focusFrame._isFloating) {
                    this._focusFrame.$frame.removeClass('wcFloatingFocus');
                }

                var oldFocusFrame = this._focusFrame;
                this._focusFrame = null;

                oldFocusFrame.__trigger(wcDocker.EVENT.LOST_FOCUS);
                if (oldFocusFrame.isCollapser() && differentFrames) {
                    oldFocusFrame.collapse();
                    oldFocusFrame.panel(-1);
                }
            }

            this._focusFrame = frame;
            if (this._focusFrame) {
                if (this._focusFrame._isFloating) {
                    this._focusFrame.$frame.addClass('wcFloatingFocus');

                    if (differentFrames) {
                        $('body').append(this._focusFrame.$frame);
                    }
                }
                this._focusFrame.__focus(flash);

                this._focusFrame.__trigger(wcDocker.EVENT.GAIN_FOCUS);
            }

            this.__orderPanels();
        },

        // Triggers an event exclusively on the docker and none of its panels.
        // Params:
        //    eventName   The name of the event.
        //    data        A custom data parameter to pass to all handlers.
        __trigger: function (eventName, data) {
            if (!eventName) {
                return;
            }

            var results = [];

            if (this._events[eventName]) {
                var events = this._events[eventName].slice(0);
                for (var i = 0; i < events.length; ++i) {
                    results.push(events[i].call(this, data));
                }
            }

            return results;
        },

        // Checks a given panel to see if it is the final remaining
        // moveable panel in the docker.
        // Params:
        //    panel     The panel.
        // Returns:
        //    true      The panel is the last.
        //    false     The panel is not the last.
        __isLastPanel: function (panel) {
            for (var i = 0; i < this._frameList.length; ++i) {
                var testFrame = this._frameList[i];
                if (testFrame._isFloating || testFrame.isCollapser()) {
                    continue;
                }
                for (var a = 0; a < testFrame._panelList.length; ++a) {
                    var testPanel = testFrame._panelList[a];
                    if (testPanel !== panel && testPanel.moveable()) {
                        return false;
                    }
                }
            }

            return true;
        },

        // Checks a given frame to see if it is the final remaining
        // moveable frame in the docker.
        // Params:
        //    frame     The frame.
        // Returns:
        //    true      The panel is the last.
        //    false     The panel is not the last.
        __isLastFrame: function (frame) {
            for (var i = 0; i < this._frameList.length; ++i) {
                var testFrame = this._frameList[i];
                if (testFrame._isFloating || testFrame === frame || testFrame.isCollapser()) {
                    continue;
                }
                for (var a = 0; a < testFrame._panelList.length; ++a) {
                    var testPanel = testFrame._panelList[a];
                    if (testPanel.moveable()) {
                        return false;
                    }
                }
            }

            return true;
        },

        // For restore, creates the appropriate object type.
        __create: function (data, parent, $container) {
            switch (data.type) {
                case 'wcSplitter':
                    var splitter = new (this.__getClass('wcSplitter'))($container, parent, data.horizontal);
                    splitter.scrollable(0, false, false);
                    splitter.scrollable(1, false, false);
                    return splitter;

                case 'wcFrame':
                    var frame = new (this.__getClass('wcFrame'))($container, parent, data.floating);
                    this._frameList.push(frame);
                    if (data.floating) {
                        this._floatingList.push(frame);
                    }
                    return frame;

                case 'wcPanel':
                    if (data.panelType === wcDocker.PANEL_PLACEHOLDER) {
                        if (!this._placeholderPanel) {
                            this._placeholderPanel = new (this.__getClass('wcPanel'))(parent, wcDocker.PANEL_PLACEHOLDER, {});
                            this._placeholderPanel._isPlaceholder = true;
                            this._placeholderPanel.__container(this.$transition);
                            this._placeholderPanel._panelObject = new function (myPanel) {
                                myPanel.title(false);
                                myPanel.closeable(false);
                                myPanel.layout().addItem($('<div style="text-align: center;">'+ parent._parent._options.placeholderHtml +'</div>'));
                            }(this._placeholderPanel);
                            this._placeholderPanel.__container($container);
                        }
                        return this._placeholderPanel;
                    } else {
                        for (var i = 0; i < this._dockPanelTypeList.length; ++i) {
                            if (this._dockPanelTypeList[i].name === data.panelType) {
                                var panel = new (this.__getClass('wcPanel'))(parent, data.panelType, this._dockPanelTypeList[i].options);
                                panel.__container(this.$transition);
                                var options = (this._dockPanelTypeList[i].options && this._dockPanelTypeList[i].options.options) || {};
                                panel._panelObject = new this._dockPanelTypeList[i].options.onCreate(panel, options);
                                panel.__container($container);
                                break;
                            }
                        }
                        return panel;
                    }
            }

            return null;
        },

        // Attempts to insert a given dock panel into an already existing frame.
        // If insertion is not possible for any reason, the panel will be
        // placed in its own frame instead.
        // Params:
        //    panel         The panel to insert.
        //    targetPanel   An optional panel to 'split', if not supplied the
        //                  new panel will split the center window.
        __addPanelGrouped: function (panel, targetPanel, options) {
            var frame = targetPanel;
            if (frame && frame.instanceOf('wcPanel')) {
                frame = targetPanel._parent;
            }

            if (frame && frame.instanceOf('wcFrame')) {
                if (options && options.tabOrientation) {
                    frame.tabOrientation(options.tabOrientation);
                }

                frame.addPanel(panel);
                return;
            }

            // If we did not manage to find a place for this panel, last resort is to put it in its own frame.
            this.__addPanelAlone(panel, wcDocker.DOCK.LEFT, targetPanel, options);
        },

        // Creates a new frame for the panel and then attaches it
        // to the window.
        // Params:
        //    panel         The panel to insert.
        //    location      The desired location for the panel.
        //    targetPanel   An optional panel to 'split', if not supplied the
        //                  new panel will split the center window.
        __addPanelAlone: function (panel, location, targetPanel, options) {
            if (targetPanel && targetPanel._shift) {
                var target = targetPanel;
                targetPanel = targetPanel._shift;
                target._shift = undefined;
            }

            if (options) {
                var width = this.$container.width();
                var height = this.$container.height();

                if (options.hasOwnProperty('x')) {
                    options.x = this.__stringToPixel(options.x, width);
                }
                if (options.hasOwnProperty('y')) {
                    options.y = this.__stringToPixel(options.y, height);
                }
                if (!options.hasOwnProperty('w')) {
                    options.w = panel.initSize().x;
                }
                if (!options.hasOwnProperty('h')) {
                    options.h = panel.initSize().y;
                }
                options.w = this.__stringToPixel(options.w, width);
                options.h = this.__stringToPixel(options.h, height);

                panel._size.x = options.w;
                panel._size.y = options.h;
            }

            // If we are collapsing the panel, put it into the collapser.
            if (targetPanel === wcDocker.COLLAPSED) {
                this.__initCollapsers();
                if (this._collapser[location]) {
                    targetPanel = this._collapser[location]._drawer._frame.addPanel(panel);
                    var self = this;
                    setTimeout(function () {
                        self.__update();
                    });
                    return panel;
                } else {
                    console.log('ERROR: Attempted to collapse panel "' + panel._type + '" to invalid location: ' + location);
                    return false;
                }
            }

            // Floating windows need no placement.
            if (location === wcDocker.DOCK.FLOAT || location === wcDocker.DOCK.MODAL) {
                var frame = new (this.__getClass('wcFrame'))(this.$container, this, true);
                if (options && options.tabOrientation) {
                    frame.tabOrientation(options.tabOrientation);
                }
                this._frameList.push(frame);
                this._floatingList.push(frame);
                this.__focus(frame);
                frame.addPanel(panel);
                frame.pos(panel._pos.x, panel._pos.y, false);

                if (location === wcDocker.DOCK.MODAL) {
                    frame.$modalBlocker = $('<div class="wcModalBlocker"></div>');
                    frame.$frame.prepend(frame.$modalBlocker);

                    panel.moveable(false);
                    frame.$frame.addClass('wcModal');
                    this._modalList.push(frame);
                }

                if (options) {
                    var pos = frame.pos(undefined, undefined, true);
                    if (options.hasOwnProperty('x')) {
                        pos.x = options.x + options.w / 2;
                    }
                    if (options.hasOwnProperty('y')) {
                        pos.y = options.y + options.h / 2;
                    }
                    frame.pos(pos.x, pos.y, true);
                    frame._size = {
                        x: options.w,
                        y: options.h
                    };
                }

                this.__orderPanels();
                return;
            }

            if (targetPanel) {
                var parentSplitter = targetPanel._parent;

                var splitterChild = targetPanel;

                while (parentSplitter && !(parentSplitter.instanceOf('wcSplitter') || parentSplitter.instanceOf('wcDocker'))) {
                    splitterChild = parentSplitter;
                    parentSplitter = parentSplitter._parent;
                }

                if (parentSplitter && parentSplitter.instanceOf('wcSplitter')) {
                    var splitter;
                    var left = parentSplitter.pane(0);
                    var right = parentSplitter.pane(1);
                    var size = {
                        x: -1,
                        y: -1
                    };
                    if (left === splitterChild) {
                        splitter = new (this.__getClass('wcSplitter'))(this.$transition, parentSplitter, location !== wcDocker.DOCK.BOTTOM && location !== wcDocker.DOCK.TOP);
                        size.x = parentSplitter.$pane[0].width();
                        size.y = parentSplitter.$pane[0].height();
                        parentSplitter.pane(0, splitter);
                    } else {
                        splitter = new (this.__getClass('wcSplitter'))(this.$transition, parentSplitter, location !== wcDocker.DOCK.BOTTOM && location !== wcDocker.DOCK.TOP);
                        size.x = parentSplitter.$pane[1].width();
                        size.y = parentSplitter.$pane[1].height();
                        parentSplitter.pane(1, splitter);
                    }

                    if (splitter) {
                        splitter.scrollable(0, false, false);
                        splitter.scrollable(1, false, false);

                        if (!options) {
                            options = {
                                w: panel._size.x,
                                h: panel._size.y
                            };
                        }

                        if (options) {
                            if (options.w < 0) {
                                options.w = size.x / 2;
                            }
                            if (options.h < 0) {
                                options.h = size.y / 2;
                            }

                            switch (location) {
                                case wcDocker.DOCK.LEFT:
                                    splitter.pos(options.w / size.x);
                                    break;
                                case wcDocker.DOCK.RIGHT:
                                    splitter.pos(1.0 - (options.w / size.x));
                                    break;
                                case wcDocker.DOCK.TOP:
                                    splitter.pos(options.h / size.y);
                                    break;
                                case wcDocker.DOCK.BOTTOM:
                                    splitter.pos(1.0 - (options.h / size.y));
                                    break;
                            }
                        } else {
                            splitter.pos(0.5);
                        }

                        frame = new (this.__getClass('wcFrame'))(this.$transition, splitter, false);
                        this._frameList.push(frame);
                        if (location === wcDocker.DOCK.LEFT || location === wcDocker.DOCK.TOP) {
                            splitter.pane(0, frame);
                            splitter.pane(1, splitterChild);
                        } else {
                            splitter.pane(0, splitterChild);
                            splitter.pane(1, frame);
                        }

                        frame.addPanel(panel);
                    }
                    return;
                }
            }

            var parent = this;
            var $container = this.$container;
            var frame = new (this.__getClass('wcFrame'))(this.$transition, parent, false);
            this._frameList.push(frame);

            if (!parent._root) {
                parent._root = frame;
                frame.__container($container);
            } else {
                var splitter = new (this.__getClass('wcSplitter'))($container, parent, location !== wcDocker.DOCK.BOTTOM && location !== wcDocker.DOCK.TOP);
                if (splitter) {
                    frame._parent = splitter;
                    splitter.scrollable(0, false, false);
                    splitter.scrollable(1, false, false);
                    var size = {
                        x: $container.width(),
                        y: $container.height()
                    };

                    if (!options) {
                        splitter.__findBestPos();
                    } else {
                        if (options.w < 0) {
                            options.w = size.x / 2;
                        }
                        if (options.h < 0) {
                            options.h = size.y / 2;
                        }

                        switch (location) {
                            case wcDocker.DOCK.LEFT:
                                splitter.pos(options.w / size.x);
                                break;
                            case wcDocker.DOCK.RIGHT:
                                splitter.pos(1.0 - (options.w / size.x));
                                break;
                            case wcDocker.DOCK.TOP:
                                splitter.pos(options.h / size.y);
                                break;
                            case wcDocker.DOCK.BOTTOM:
                                splitter.pos(1.0 - (options.h / size.y));
                                break;
                        }
                    }

                    if (location === wcDocker.DOCK.LEFT || location === wcDocker.DOCK.TOP) {
                        splitter.pane(0, frame);
                        splitter.pane(1, parent._root);
                    } else {
                        splitter.pane(0, parent._root);
                        splitter.pane(1, frame);
                    }

                    parent._root = splitter;
                }
            }

            frame.addPanel(panel);
        },

        __addCollapser: function (location, parent) {
            var collapser = null;
            if (parent) {
                var parentSplitter = parent._parent;
                var splitterChild = parent;
                var _d = dcl;

                while (parentSplitter && !(parentSplitter.instanceOf('wcSplitter') || parentSplitter.instanceOf('wcDocker'))){
                    splitterChild = parentSplitter;
                    parentSplitter = parentSplitter._parent;
                }

                var splitter = new (this.__getClass('wcSplitter'))(this.$transition, parentSplitter, location !== wcDocker.DOCK.BOTTOM && location !== wcDocker.DOCK.TOP);

                if (parentSplitter && parentSplitter.instanceOf('wcDocker')){
                    this._root = splitter;
                    splitter.__container(this.$container);
                }

                if (parentSplitter && parentSplitter.instanceOf('wcSplitter')) {
                    var left = parentSplitter.left();
                    var right = parentSplitter.right();
                    var size = {
                        x: -1,
                        y: -1
                    };
                    if (left === splitterChild) {
                        size.x = parentSplitter.$pane[0].width();
                        size.y = parentSplitter.$pane[0].height();
                        parentSplitter.pane(0, splitter);
                    } else {
                        splitter = new (this.__getClass('wcSplitter'))(this.$transition, parentSplitter, location !== wcDocker.DOCK.BOTTOM && location !== wcDocker.DOCK.TOP);
                        size.x = parentSplitter.$pane[1].width();
                        size.y = parentSplitter.$pane[1].height();
                        parentSplitter.pane(1, splitter);
                    }
                }


                if (splitter) {
                    splitter.scrollable(0, false, false);
                    splitter.scrollable(1, false, false);
                    collapser = new (this.__getClass('wcCollapser'))(this.$transition, splitter, location);
                    switch (location) {
                        case wcDocker.DOCK.TOP:
                        case wcDocker.DOCK.LEFT:
                            splitter.pos(0);
                            break;
                        case wcDocker.DOCK.BOTTOM:
                        case wcDocker.DOCK.RIGHT:
                            splitter.pos(1);
                            break;
                    }

                    if (location === wcDocker.DOCK.LEFT || location === wcDocker.DOCK.TOP) {
                        splitter.pane(0, collapser);
                        splitter.pane(1, splitterChild);
                    } else {
                        splitter.pane(0, splitterChild);
                        splitter.pane(1, collapser);
                    }
                }
            }
            return collapser;
        },

        // Adds the placeholder panel as needed
        __addPlaceholder: function (targetPanel, placeholderHtml) {
            if (this._placeholderPanel) {
                console.log('WARNING: wcDocker creating placeholder panel when one already exists');
            }

            this._placeholderPanel = new (this.__getClass('wcPanel'))(this, wcDocker.PANEL_PLACEHOLDER, {});
            this._placeholderPanel._isPlaceholder = true;
            this._placeholderPanel.__container(this.$transition);
            this._placeholderPanel._panelObject = new function (myPanel) {
                myPanel.title(false);
                myPanel.closeable(false);
                if (placeholderHtml) {
                    myPanel.layout().addItem($('<div style="text-align: center;">'+ placeholderHtml +'</div>'));
                }
            }(this._placeholderPanel);

            if (targetPanel) {
                this.__addPanelGrouped(this._placeholderPanel, targetPanel);
            } else {
                this.__addPanelAlone(this._placeholderPanel, wcDocker.DOCK.TOP);
            }

            this.__update();
        },

        __closePanel: function(panel) {
            // If the panel is persistent, instead of destroying it, add it to a persistent list instead.
            var dontDestroy = false;
            var panelOptions = this.panelTypeInfo(panel._type);
            if (panelOptions && panelOptions.isPersistent) {
                dontDestroy = true;
                this._persistentList.push(panel);
            }
            this.removePanel(panel, dontDestroy);
            this.__update();
        },

        // Converts a potential string value to a percentage.
        __stringToPercent: function (value, size) {
            if (typeof value === 'string') {
                if (value.indexOf('%', value.length - 1) !== -1) {
                    return parseFloat(value) / 100;
                } else if (value.indexOf('px', value.length - 2) !== -1) {
                    return parseFloat(value) / size;
                }
            }
            return parseFloat(value);
        },

        // Converts a potential string value to a pixel value.
        __stringToPixel: function (value, size) {
            if (typeof value === 'string') {
                if (value.indexOf('%', value.length - 1) !== -1) {
                    return (parseFloat(value) / 100) * size;
                } else if (value.indexOf('px', value.length - 2) !== -1) {
                    return parseFloat(value);
                }
            }
            return parseFloat(value);
        }
    });

    //merge types into module
    for(var prop in wcDocker){
        Module[prop] = wcDocker[prop];
    }

    //track and expose default classes
    Module.defaultClasses = defaultClasses;

    return Module;
});
/** @module wcIFrame */
define('wcDocker/iframe',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcIFrame
     * The wcIFrame widget makes it easier to include an iFrame element into your panel.
     * Because an iFrame's contents is cleared whenever it is moved in the DOM heirarchy
     * (and changing a panels docking position causes DOM movement), special care must
     * be taken when using them.<br><br>
     *
     * This will create an iFrame element and place it in a static (non-changing) DOM
     * location. It will then sync its size and position to match the container area of
     * this wcIFrame widget. It works rather well, but has its limitations. Since the
     * iFrame is essentially on top of the window, it can not be only partially hidden.
     * If the wcIFrame container is partially hidden outside the bounds of the panel,
     * the iFrame will not be hidden.
     * {@tutorial 3.0-widgets}
     */
    var Module = dcl(base, {
        declaredClass: 'wcIFrame',

        /**
         * @memberOf module:wcIFrame
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this layout.
         * @param {module:wcPanel} parent - The iframes's parent panel.
         */
        constructor:function(container, panel) {

            this._panel = panel;
            this._layout = panel.layout();

            this.$container = $(container);
            this.$frame = null;
            this.$focus = null;

            /**
             * The iFrame element.
             * @member {external:jQuery~Object}
             */
            this.$iFrame = null;

            this._window = null;
            this._isDocking = false;
            this._isHovering = false;

            this._boundEvents = [];

            this._onLoadFuncs = [];
            this._onClosedFuncs = [];

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Opens a given URL address into the iFrame.
         * @function module:wcIFrame#openURL
         * @param {String} url - The full, or relative, path to the page.
         */
        openURL: function (url) {
            this.__clearFrame();

            this.$iFrame = $('<iframe>iFrames not supported on your device!</iframe>');
            this.$frame.prepend(this.$iFrame);

            this.__onMoved();
            this._window = this.$iFrame[0].contentWindow || this.$iFrame[0];
            this.__updateFrame();
            this._window.location.replace(url);

            this.$iFrame[0].focus();
            this.$iFrame.hover(this.__onHoverEnter.bind(this), this.__onHoverExit.bind(this));

            var self = this;
            this.$iFrame.load(function () {
                for (var i = 0; i < self._onLoadFuncs.length; ++i) {
                    self._onLoadFuncs[i]();
                }
                self._onLoadFuncs = [];
            });
        },

        /**
         * Populates the iFrame with the given HTML source code using the document to write data.
         * @function module:wcIFrame#openHTML
         * @param {String} html - The HTML source code.
         */
        openHTML: function (html) {
            this.__clearFrame();

            this.$iFrame = $('<iframe>iFrames not supported on your device!</iframe>');
            this.$frame.prepend(this.$iFrame);

            this.__onMoved();
            this._window = this.$iFrame[0].contentWindow || this.$iFrame[0];
            this.__updateFrame();

            // Write the frame source.
            this._window.document.open();
            this._window.document.write(html);
            this._window.document.close();

            this.$iFrame[0].focus();
            this.$iFrame.hover(this.__onHoverEnter.bind(this), this.__onHoverExit.bind(this));

            var self = this;
            this.$iFrame.load(function () {
                for (var i = 0; i < self._onLoadFuncs.length; ++i) {
                    self._onLoadFuncs[i]();
                }
                self._onLoadFuncs = [];
            });
        },

        /**
         * Populates the iFrame with the given HTML source code using the srcdoc attribute.
         * @version 3.0.0
         * @function module:wcIFrame#openSRC
         * @param {String} html - The HTML source code.
         */
        openSRC: function (html) {
            this.__clearFrame();

            this.$iFrame = $('<iframe>iFrames not supported on your device!</iframe>');
            this.$frame.prepend(this.$iFrame);

            this.__onMoved();
            this._window = this.$iFrame[0].contentWindow || this.$iFrame[0];
            this.__updateFrame();

            // Write the frame source.
            this.$iFrame[0].srcdoc = html;
            this.$iFrame[0].focus();
            this.$iFrame.hover(this.__onHoverEnter.bind(this), this.__onHoverExit.bind(this));

            var self = this;
            this.$iFrame.load(function () {
                for (var i = 0; i < self._onLoadFuncs.length; ++i) {
                    self._onLoadFuncs[i]();
                }
                self._onLoadFuncs = [];
            });
        },

        /**
         * Registers an event handler when the contents of this iFrame has loaded.
         * @function module:wcIFrame#onLoaded
         * @param {Function} onLoadedFunc - A function to call when the iFrame has loaded.
         */
        onLoaded: function(onLoadedFunc) {
            this._onLoadFuncs.push(onLoadedFunc);
        },

        /**
         * Registers an event handler when the iFrame has been closed.
         * @function module:wcIFrame#onClosed
         * @param {Function} onClosedFunc - A function to call when the iFrame has closed.
         */
        onClosed: function(onClosedFunc) {
            this._onClosedFuncs.push(onClosedFunc);
        },

        /**
         * Allows the iFrame to be visible when the panel is visible.
         * @function module:wcIFrame#show
         */
        show: function () {
            if (this.$frame) {
                this.$frame.removeClass('wcIFrameHidden');
            }
        },

        /**
         * Forces the iFrame to be hidden, regardless of whether the panel is visible.
         * @function module:wcIFrame#hide
         */
        hide: function () {
            if (this.$frame) {
                this.$frame.addClass('wcIFrameHidden');
            }
        },

        /**
         * Retrieves the window object from the iFrame element.
         * @function module:wcIFrame#window
         * @returns {Object} - The window object.
         */
        window: function () {
            return this._window;
        },

        /**
         * Destroys the iFrame element and clears all references.<br>
         * <b>Note:</b> This is automatically called when the owner panel is destroyed.
         * @function module:wcIFrame#destroy
         */
        destroy: function () {
            // Remove all registered events.
            while (this._boundEvents.length) {
                this._panel.off(this._boundEvents[0].event, this._boundEvents[0].handler);
                this._boundEvents.shift();
            }

            this.__clearFrame();
            this._panel = null;
            this._layout = null;
            this.$container = null;
            this.$frame.remove();
            this.$frame = null;
            this.$focus = null;
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Private Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        __init: function () {
            this.$frame = $('<div class="wcIFrame">');
            this.$focus = $('<div class="wcIFrameFocus">');
            this._panel.docker().$container.append(this.$frame);
            this.$frame.append(this.$focus);

            this._boundEvents.push({event: wcDocker.EVENT.VISIBILITY_CHANGED, handler: this.__onVisibilityChanged.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.BEGIN_DOCK, handler: this.__onBeginDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.END_DOCK, handler: this.__onEndDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ATTACHED, handler: this.__onAttached.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.DETACHED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.GAIN_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.LOST_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_OPENED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_CLOSED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.CLOSED, handler: this.__onClosed.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ORDER_CHANGED, handler: this.__onOrderChanged.bind(this)});

            for (var i = 0; i < this._boundEvents.length; ++i) {
                this._panel.on(this._boundEvents[i].event, this._boundEvents[i].handler);
            }

            $(window).blur(this.__onBlur.bind(this));
        },

        __clearFrame: function () {
            if (this.$iFrame) {
                for (var i = 0; i < this._onClosedFuncs.length; ++i) {
                    this._onClosedFuncs[i]();
                }
                this._onClosedFuncs = [];

                this.$iFrame[0].srcdoc = '';
                this.$iFrame.remove();
                this.$iFrame = null;
                this._window = null;
            }
        },

        __updateFrame: function () {
            if (this.$frame && this._panel) {
                var floating = this._panel.isFloating();
                this.$frame.toggleClass('wcIFrameFloating', floating);
                if (floating) {
                    this.$frame.toggleClass('wcIFrameFloatingFocus', focus);
                } else {
                    this.$frame.removeClass('wcIFrameFloatingFocus');
                }
                this.$frame.toggleClass('wcIFramePanelHidden', !this._panel.isVisible());
                if (this._panel && this._panel._parent && this._panel._parent.instanceOf('wcFrame')) {
                    this.$frame.toggleClass('wcDrawer', this._panel._parent.isCollapser());
                }
            }
        },

        __focusFix: function () {
            // Fixes a bug where the frame stops responding to mouse wheel after
            // it has been assigned and unassigned pointer-events: none in css.
            this.$frame.css('left', parseInt(this.$frame.css('left')) + 1);
            this.$frame.css('left', parseInt(this.$frame.css('left')) - 1);
        },

        __onHoverEnter: function () {
            this._isHovering = true;
        },

        __onHoverExit: function () {
            this._isHovering = false;
        },

        __onBlur: function () {
            if (this._isHovering) {
                this.__onFocus();
            }
        },

        __onFocus: function () {
            if (this._panel) {
                this.docker(this._panel).__focus(this._panel._parent);
            }
        },

        __onVisibilityChanged: function () {
            this.__updateFrame();
            if (this._panel.isVisible()) {
                this.__onMoved();
            }
        },

        __onBeginDock: function () {
            if (this.$frame) {
                this._isDocking = true;
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onEndDock: function () {
            if (this.$frame) {
                this._isDocking = false;
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },

        __onAttached: function() {
            this.$frame.css('z-index', '');
            this.__updateFrame();
        },

        __onMoveStarted: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onMoveFinished: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },
        __onMoved: function () {
            if (this.$frame && this._panel) {
                // Size, position, and show the frame once the move is finished.
                var docker = this.docker(this._panel);//in base
                if(docker) {
                    var dockerPos = docker.$container.offset();
                    var pos = this.$container.offset();
                    var width = this.$container.width();
                    var height = this.$container.height();

                    this.$frame.css('top', pos.top - dockerPos.top);
                    this.$frame.css('left', pos.left - dockerPos.left);
                    this.$frame.css('width', width);
                    this.$frame.css('height', height);
                }else{
                    console.error('have no docker');
                }
            }
        },
        __onOrderChanged: function(layer) {
            this.$frame.css('z-index', layer+1);
        },
        __onClosed: function () {
            this.destroy();
        }
    });

    // window['wcIFrame'] = Module;

    return Module;

});

/** @module wcWebView*/
define('wcDocker/webview',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcWebView
     * The wcWebView widget makes it easier to include an webView element into your panel.
     * Because an webView's contents is cleared whenever it is moved in the DOM heirarchy
     * (and changing a panels docking position causes DOM movement), special care must
     * be taken when using them.<br><br>
     *
     * This will create an webView element and place it in a static (non-changing) DOM
     * location. It will then sync its size and position to match the container area of
     * this wcWebView widget. It works rather well, but has its limitations. Since the
     * webView is essentially on top of the window, it can not be only partially hidden.
     * If the wcWebView container is partially hidden outside the bounds of the panel,
     * the webView will not be hidden.
     * {@tutorial 3.0-widgets}
     */
    var Module = dcl(base, {
        declaredClass: 'wcIFrame',

        /**
         * @memberOf module:wcWebView
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this layout.
         * @param {module:wcPanel} parent - The webviews's parent panel.
         */
        constructor:function(container, panel) {

            this._panel = panel;
            this._layout = panel.layout();

            this.$container = $(container);
            this.$frame = null;
            this.$focus = null;

            /**
             * The webView element.
             * @member {external:jQuery~Object}
             */
            this.$webView = null;

            this._window = null;
            this._isDocking = false;
            this._isHovering = false;

            this._boundEvents = [];
            this._onBeforeAppendFuncs = [];
            this._onLoadFuncs = [];
            this._onClosedFuncs = [];

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Opens a given URL address into the webView.
         * @function module:wcWebView#openURL
         * @param {String} url - The full, or relative, path to the page.
         */
        openURL: function (url,options) {

            var self = this;
            options = options || []
            this.__clearFrame();

            this.$webView = $('<webview style="height: 100%; width: 100%"></webview>');
            this.$webView[0].src = url;
            var allowedOptions = ['partition','preload','webpreferences','allowpopups','blinkfeatures','disableblinkfeatures','guestinstance','disableguestresize'];
            allowedOptions.forEach(function(o) {
                if (options[o])
                    self.$webView[0][o] = options[o];
            })

            for (var i = 0; i < self._onBeforeAppendFuncs.length; ++i) {
                self._onBeforeAppendFuncs[i](self,options);
            }

            this.$frame.prepend(this.$webView);

            this.__onMoved();
            this._window = this.$webView[0];
            this.__updateFrame();

            this.$webView[0].focus();
            this.$webView.hover(this.__onHoverEnter.bind(this), this.__onHoverExit.bind(this));

            this.$webView.on('did-finish-load',function () {
                for (var i = 0; i < self._onLoadFuncs.length; ++i) {
                    self._onLoadFuncs[i](self);
                }
            });
        },

        /**
         * Registers an event handler for calling before the webView is appended to the DOM.
         * @function module:wcWebView#onBeforeAppend
         * @param {Function} func - A function to call before the webView has been appended to the DOM.
         */
        onBeforeAppend: function(func)
        {
            this._onBeforeAppendFuncs.push(func);
        },

        /**
         * Registers an event handler when the contents of this webView has loaded.
         * @function module:wcWebView#onLoaded
         * @param {Function} onLoadedFunc - A function to call when the webView has loaded.
         */
        onLoaded: function(onLoadedFunc) {
            this._onLoadFuncs.push(onLoadedFunc);
        },

        /**
         * Registers an event handler when the webView has been closed.
         * @function module:wcWebView#onClosed
         * @param {Function} onClosedFunc - A function to call when the webView has closed.
         */
        onClosed: function(onClosedFunc) {
            this._onClosedFuncs.push(onClosedFunc);
        },

        /**
         * Allows the webView to be visible when the panel is visible.
         * @function module:wcWebView#show
         */
        show: function () {
            if (this.$frame) {
                this.$frame.removeClass('wcIFrameHidden');
            }
        },

        /**
         * Forces the webView to be hidden, regardless of whether the panel is visible.
         * @function module:wcWebView#hide
         */
        hide: function () {
            if (this.$frame) {
                this.$frame.addClass('wcIFrameHidden');
            }
        },

        /**
         * Retrieves the window object from the webView element.
         * @function module:wcWebView#window
         * @returns {Object} - The window object.
         */
        window: function () {
            return this._window;
        },

        /**
         * Destroys the webView element and clears all references.<br>
         * <b>Note:</b> This is automatically called when the owner panel is destroyed.
         * @function module:wcWebView#destroy
         */
        destroy: function () {
            // Remove all registered events.
            while (this._boundEvents.length) {
                this._panel.off(this._boundEvents[0].event, this._boundEvents[0].handler);
                this._boundEvents.shift();
            }

            this.__clearFrame();
            this._panel = null;
            this._layout = null;
            this.$container = null;
            this.$frame.remove();
            this.$frame = null;
            this.$focus = null;
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Private Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        __init: function () {
            this.$frame = $('<div class="wcIFrame">');
            this.$focus = $('<div class="wcIFrameFocus">');
            this._panel.docker().$container.append(this.$frame);
            this.$frame.append(this.$focus);

            this._boundEvents.push({event: wcDocker.EVENT.VISIBILITY_CHANGED, handler: this.__onVisibilityChanged.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.BEGIN_DOCK, handler: this.__onBeginDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.END_DOCK, handler: this.__onEndDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ATTACHED, handler: this.__onAttached.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.DETACHED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.GAIN_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.LOST_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_OPENED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_CLOSED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.CLOSED, handler: this.__onClosed.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ORDER_CHANGED, handler: this.__onOrderChanged.bind(this)});

            for (var i = 0; i < this._boundEvents.length; ++i) {
                this._panel.on(this._boundEvents[i].event, this._boundEvents[i].handler);
            }

            $(window).blur(this.__onBlur.bind(this));
        },

        __clearFrame: function () {
            if (this.$webView) {
                for (var i = 0; i < this._onClosedFuncs.length; ++i) {
                    this._onClosedFuncs[i]();
                }
                this._onClosedFuncs = [];

                this.$webView[0].srcdoc = '';
                this.$webView.remove();
                this.$webView = null;
                this._window = null;
            }
        },

        __updateFrame: function () {
            if (this.$frame && this._panel) {
                var floating = this._panel.isFloating();
                this.$frame.toggleClass('wcIFrameFloating', floating);
                if (floating) {
                    this.$frame.toggleClass('wcIFrameFloatingFocus', focus);
                } else {
                    this.$frame.removeClass('wcIFrameFloatingFocus');
                }
                this.$frame.toggleClass('wcIFramePanelHidden', !this._panel.isVisible());
                if (this._panel && this._panel._parent && this._panel._parent.instanceOf('wcFrame')) {
                    this.$frame.toggleClass('wcDrawer', this._panel._parent.isCollapser());
                }
            }
        },

        __focusFix: function () {
            // Fixes a bug where the frame stops responding to mouse wheel after
            // it has been assigned and unassigned pointer-events: none in css.
            this.$frame.css('left', parseInt(this.$frame.css('left')) + 1);
            this.$frame.css('left', parseInt(this.$frame.css('left')) - 1);
        },

        __onHoverEnter: function () {
            this._isHovering = true;
        },

        __onHoverExit: function () {
            this._isHovering = false;
        },

        __onBlur: function () {
            if (this._isHovering) {
                this.__onFocus();
            }
        },

        __onFocus: function () {
            if (this._panel) {
                this.docker(this._panel).__focus(this._panel._parent);
            }
        },

        __onVisibilityChanged: function () {
            this.__updateFrame();
            if (this._panel.isVisible()) {
                this.__onMoved();
            }
        },

        __onBeginDock: function () {
            if (this.$frame) {
                this._isDocking = true;
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onEndDock: function () {
            if (this.$frame) {
                this._isDocking = false;
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },

        __onAttached: function() {
            this.$frame.css('z-index', '');
            this.__updateFrame();
        },

        __onMoveStarted: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onMoveFinished: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },
        __onMoved: function () {
            if (this.$frame && this._panel) {
                // Size, position, and show the frame once the move is finished.
                var docker = this.docker(this._panel);//in base
                if(docker) {
                    var dockerPos = docker.$container.offset();
                    var pos = this.$container.offset();
                    var width = this.$container.width();
                    var height = this.$container.height();

                    this.$frame.css('top', pos.top - dockerPos.top);
                    this.$frame.css('left', pos.left - dockerPos.left);
                    this.$frame.css('width', width);
                    this.$frame.css('height', height);
                }else{
                    console.error('have no docker');
                }
            }
        },
        __onOrderChanged: function(layer) {
            this.$frame.css('z-index', layer+1);
        },
        __onClosed: function () {
            this.destroy();
        }
    });

    // window['wcIFrame'] = Module;

    return Module;

});

/** @module wcAbsolute*/
define('wcDocker/absolute',[
    "dcl/dcl",
    "./types",
    "./base"
], function (dcl, wcDocker, base) {

    /**
     * @class module:wcAbsolute
     * The wcAbsolute widget makes it easier to wrap an absolute positioned element into your panel.
     */
    var Module = dcl(base, {
        declaredClass: 'wcIFrame', // Retained for CSS simplicity

        /**
         * @memberOf module:wcAbsolute
         * @param {external:jQuery~selector|external:jQuery~Object|external:domNode} container - A container element for this layout.
         * @param {module:wcPanel} parent - The webviews's parent panel.
         */
        constructor:function(container, panel) {

            this._panel = panel;
            this._layout = panel.layout();

            this.$container = $(container);
            this.$frame = null;
            this.$focus = null;

            this._isDocking = false;
            this._isHovering = false;

            this._boundEvents = [];
            this._onClosedFuncs = [];

            this.__init();
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Public Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        /**
         * Set the content
         * @function module:wcAbsolute#setContent
         * @param {HTMLElement|JQueryElement|string} content - The content
         */
        setContent: function (content,options) {

            var self = this;
            options = options || []
            this.__clearFrame();
            this.$content = $(content);
            this.$frame.prepend(this.$content);

            this.__onMoved();
            this.__updateFrame();

            this.$content.hover(this.__onHoverEnter.bind(this), this.__onHoverExit.bind(this));
        },


        /**
         * Registers an event handler when the content has been closed.
         * @function module:wcAbsolute#onClosed
         * @param {Function} onClosedFunc - A function to call when the webView has closed.
         */
        onClosed: function(onClosedFunc) {
            this._onClosedFuncs.push(onClosedFunc);
        },

        /**
         * Allows the webView to be visible when the panel is visible.
         * @function module:wcAbsolute#show
         */
        show: function () {
            if (this.$frame) {
                this.$frame.removeClass('wcIFrameHidden');
            }
        },

        /**
         * Forces the webView to be hidden, regardless of whether the panel is visible.
         * @function module:wcAbsolute#hide
         */
        hide: function () {
            if (this.$frame) {
                this.$frame.addClass('wcIFrameHidden');
            }
        },
        /**
         * Destroys the webView element and clears all references.<br>
         * <b>Note:</b> This is automatically called when the owner panel is destroyed.
         * @function module:wcAbsolute#destroy
         */
        destroy: function () {
            // Remove all registered events.
            while (this._boundEvents.length) {
                this._panel.off(this._boundEvents[0].event, this._boundEvents[0].handler);
                this._boundEvents.shift();
            }

            this.__clearFrame();
            this._panel = null;
            this._layout = null;
            this.$container = null;
            this.$frame.remove();
            this.$frame = null;
            this.$focus = null;
        },

        ///////////////////////////////////////////////////////////////////////////////////////////////////////
        // Private Functions
        ///////////////////////////////////////////////////////////////////////////////////////////////////////

        __init: function () {
            this.$frame = $('<div class="wcIFrame">');
            this.$focus = $('<div class="wcIFrameFocus">');
            this._panel.docker().$container.append(this.$frame);
            this.$frame.append(this.$focus);

            this._boundEvents.push({event: wcDocker.EVENT.VISIBILITY_CHANGED, handler: this.__onVisibilityChanged.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.BEGIN_DOCK, handler: this.__onBeginDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.END_DOCK, handler: this.__onEndDock.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_STARTED, handler: this.__onMoveStarted.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZE_ENDED, handler: this.__onMoveFinished.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.MOVED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.RESIZED, handler: this.__onMoved.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ATTACHED, handler: this.__onAttached.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.DETACHED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.GAIN_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.LOST_FOCUS, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_OPENED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.PERSISTENT_CLOSED, handler: this.__updateFrame.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.CLOSED, handler: this.__onClosed.bind(this)});
            this._boundEvents.push({event: wcDocker.EVENT.ORDER_CHANGED, handler: this.__onOrderChanged.bind(this)});

            for (var i = 0; i < this._boundEvents.length; ++i) {
                this._panel.on(this._boundEvents[i].event, this._boundEvents[i].handler);
            }

            $(window).blur(this.__onBlur.bind(this));
        },

        __clearFrame: function () {
            if (this.$content) {
                for (var i = 0; i < this._onClosedFuncs.length; ++i) {
                    this._onClosedFuncs[i]();
                }
                this._onClosedFuncs = [];
            }
        },

        __updateFrame: function () {
            if (this.$frame && this._panel) {
                var floating = this._panel.isFloating();
                this.$frame.toggleClass('wcIFrameFloating', floating);
                if (floating) {
                    this.$frame.toggleClass('wcIFrameFloatingFocus', focus);
                } else {
                    this.$frame.removeClass('wcIFrameFloatingFocus');
                }
                this.$frame.toggleClass('wcIFramePanelHidden', !this._panel.isVisible());
                if (this._panel && this._panel._parent && this._panel._parent.instanceOf('wcFrame')) {
                    this.$frame.toggleClass('wcDrawer', this._panel._parent.isCollapser());
                }
            }
        },

        __focusFix: function () {
            // Fixes a bug where the frame stops responding to mouse wheel after
            // it has been assigned and unassigned pointer-events: none in css.
            this.$frame.css('left', parseInt(this.$frame.css('left')) + 1);
            this.$frame.css('left', parseInt(this.$frame.css('left')) - 1);
        },

        __onHoverEnter: function () {
            this._isHovering = true;
        },

        __onHoverExit: function () {
            this._isHovering = false;
        },

        __onBlur: function () {
            if (this._isHovering) {
                this.__onFocus();
            }
        },

        __onFocus: function () {
            if (this._panel) {
                this.docker(this._panel).__focus(this._panel._parent);
            }
        },

        __onVisibilityChanged: function () {
            this.__updateFrame();
            if (this._panel.isVisible()) {
                this.__onMoved();
            }
        },

        __onBeginDock: function () {
            if (this.$frame) {
                this._isDocking = true;
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onEndDock: function () {
            if (this.$frame) {
                this._isDocking = false;
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },

        __onAttached: function() {
            this.$frame.css('z-index', '');
            this.__updateFrame();
        },

        __onMoveStarted: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.addClass('wcIFrameMoving');
            }
        },

        __onMoveFinished: function () {
            if (this.$frame && !this._isDocking) {
                this.$frame.removeClass('wcIFrameMoving');
                this.__focusFix();
            }
        },
        __onMoved: function () {
            if (this.$frame && this._panel) {
                // Size, position, and show the frame once the move is finished.
                var docker = this.docker(this._panel);//in base
                if(docker) {
                    var dockerPos = docker.$container.offset();
                    var pos = this.$container.offset();
                    var width = this.$container.width();
                    var height = this.$container.height();

                    this.$frame.css('top', pos.top - dockerPos.top);
                    this.$frame.css('left', pos.left - dockerPos.left);
                    this.$frame.css('width', width);
                    this.$frame.css('height', height);
                }else{
                    console.error('have no docker');
                }
            }
        },
        __onOrderChanged: function(layer) {
            this.$frame.css('z-index', layer+1);
        },
        __onClosed: function () {
            this.destroy();
        }
    });

    // window['wcIFrame'] = Module;

    return Module;

});

require.config({
    baseUrl: "./bower_components",
    shim: {
        // Libraries
        lodash: {
            exports: '_'
        }
    },
    packages: [
        {
            name: 'dcl',
            location: './dcl'   //points to bower_components/dcl
        },
        {
            name: 'wcDocker',
            location: '../Code'
        },
        {
            name: 'lodash',
            location: './lodash-compat'   //points to bower_components/dcl
        }
    ]
});

require.config({
    config: {}
});

//require docker
require([
    "wcDocker/docker",
    "wcDocker/splitter",
    "wcDocker/tabframe",
    "wcDocker/iframe",
    // "wcDocker/ThemeBuilder",
    "wcDocker/webview",
    "wcDocker/absolute"
], function (wcDocker, wcSplitter, wcTabFrame, wcIFrame, /* wcThemeBuilder, */wcWebView, wcAbsolute) {

    //export
    window['wcDocker'] = wcDocker;
    window['wcSplitter'] = wcSplitter;
    window['wcTabFrame'] = wcTabFrame;
    window['wcIFrame'] = wcIFrame;
    window['wcWebView'] = wcWebView;
    window['wcAbsolute'] = wcAbsolute;
    // window['wcThemeBuilder'] = wcThemeBuilder;
    console.log('exported wcDocker');
}, undefined, true);    // Force synchronous loading so we don't have to wait.;
define("wcDockerLibrary", function(){});

}());