if (!Element.prototype.toggleAttribute) {
    Element.prototype.toggleAttribute = function (name, force) {
        if (force !== undefined) {
            if (force) {
                this.setAttribute(name, "");
            } else {
                this.removeAttribute(name);
            }
            return force;
        } else {
            if (this.hasAttribute(name)) {
                this.removeAttribute(name);
                return false;
            } else {
                this.setAttribute(name, "");
                return true;
            }
        }
    };
}
