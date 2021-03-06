/** @module wcGhost **/
define([
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
