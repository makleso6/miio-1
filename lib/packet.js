'use strict';

const crypto = require('crypto');
const debug = require('debug')('miio:packet');

class Packet {
	constructor(discovery = false) {
		this.discovery = discovery;

		this.header = Buffer.alloc(2 + 2 + 4 + 4 + 4 + 16);
		this.header[0] = 0x21;
		this.header[1] = 0x31;

		for(let i=4; i<32; i++) {
			this.header[i] = 0xff;
		}

		this._serverStampTime = 0;
		this._token = null;
	}

	handshake() {
		this.data = null;
	}

	handleHandshakeReply() {
		if(this._token === null) {
			const token = this.checksum;
			if(token.toString('hex').match(/^[fF0]+$/)) {
				debug('token ->', token);
				// Device did not return its token so we set our token to null
				this._token = null;
			} else {
				this.token = this.checksum;
				debug('checksum ->', this.checksum);

			}
		}
	}

	get needsHandshake() {
		/*
		 * Handshake if we:
		 * 1) do not have a token
		 * 2) it has been longer then 120 seconds since last received message
		 */
		return ! this._token || (Date.now() - this._serverStampTime) > 120000;
	}

	get raw() {
		if(this.data) {
			debug('data ->', this.data);
			// Send a command to the device
			if(! this._token) {
				debug('_token ->', this._token);
				debug('Token is required to send commands');
				throw new Error('Token is required to send commands');
			}

			for(let i=4; i<8; i++) {
				this.header[i] = 0x00;
			}

			// Update the stamp to match server
			if(this._serverStampTime) {
				const secondsPassed = Math.floor(Date.now() - this._serverStampTime) / 1000;
				this.header.writeUInt32BE(this._serverStamp + secondsPassed, 12);
			}

			// Encrypt the data
			let cipher = crypto.createCipheriv('aes-128-cbc', this._tokenKey, this._tokenIV);
			let encrypted = Buffer.concat([
				cipher.update(this.data),
				cipher.final()
			]);

			// Set the length
			this.header.writeUInt16BE(32 + encrypted.length, 2);

			// Calculate the checksum
			let digest = crypto.createHash('md5')
				.update(this.header.slice(0, 16))
				.update(this._token)
				.update(encrypted)
				.digest();
			digest.copy(this.header, 16);

			debug('this.header -> ', this.header);
			var __data = Buffer.concat([ this.header, encrypted ]);
			debug('<- will send contacted, checksum was', JSON.stringify(__data));
			return __data;


		} else {
			// Handshake
			this.header.writeUInt16BE(32, 2);

			for(let i=4; i<32; i++) {
				this.header[i] = 0xff;
			}

			debug('->', this.header);
			return this.header;
		}
	}

	set raw(msg) {
		msg.copy(this.header, 0, 0, 32);
		debug('<-', this.header);

		const stamp = this.stamp;
		if(stamp > 0) {
			// If the device returned a stamp, store it
			this._serverStamp = this.stamp;
			this._serverStampTime = Date.now();
		}

		const encrypted = msg.slice(32);

		if(this.discovery) {
			debug('tdiscovery');
			// This packet is only intended to be used for discovery
			debug('this.data ->', this.data);
			this.data = encrypted.length > 0;
			debug('this.data ->', this.data);
		} else {
			// Normal packet, decrypt data
			if(encrypted.length > 0) {
				if(! this._token) {
					debug('<- No token set, unable to handle packet');
					this.data = null;
					return;
				}

				const digest = crypto.createHash('md5')
					.update(this.header.slice(0, 16))
					.update(this._token)
					.update(encrypted)
					.digest();

				const checksum = this.checksum;
				if(! checksum.equals(digest)) {
					debug('<- Invalid packet, checksum was', checksum, 'should be', digest);
					this.data = null;
				} else {
					let decipher = crypto.createDecipheriv('aes-128-cbc', this._tokenKey, this._tokenIV);
					this.data = Buffer.concat([
						decipher.update(encrypted),
						decipher.final()
					]);
					debug('<- will recive contacted, checksum was', JSON.stringify(this.data));
					
				}
			} else {
				this.data = null;
			}
		}
	}

	get token() {
		return this._token;
	}

	set token(t) {
		this._token = Buffer.from(t);
		debug('set token ->', this._token);
		this._tokenKey = crypto.createHash('md5').update(t).digest();
		debug('_tokenKey ->', this._tokenKey);
		this._tokenIV = crypto.createHash('md5').update(this._tokenKey).update(t).digest();
		debug('_tokenKey ->', this._tokenIV);
	}

	get checksum() {
		var _checksum = this.header.slice(16)
		debug('_checksum ->', _checksum);
		return _checksum;
	}

	get deviceId() {
		var _deviceId = this.header.readUInt32BE(8);
		debug('_deviceId ->', _deviceId);
		return _deviceId;
	}

	get stamp() {
		var _stamp = this.header.readUInt32BE(12);
		debug('_stamp ->', _stamp);
		return _stamp;
	}
}

module.exports = Packet;
