/** @module wcAbsolute*/
define([
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
