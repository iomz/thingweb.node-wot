/********************************************************************************
 * Copyright (c) 2018 Contributors to the Eclipse Foundation
 * 
 * See the NOTICE file(s) distributed with this work for additional
 * information regarding copyright ownership.
 * 
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0, or the W3C Software Notice and
 * Document License (2015-05-13) which is available at
 * https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document.
 * 
 * SPDX-License-Identifier: EPL-2.0 OR W3C-20150513
 ********************************************************************************/

import * as WoT from "wot-typescript-definitions";

import * as TD from "@node-wot/td-tools";

import Servient from "./servient";
import * as Helpers from "./helpers";

import { ProtocolClient } from "./resource-listeners/protocol-interfaces";

import ContentSerdes from "./content-serdes"

import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';

export interface ClientAndForm {
    client: ProtocolClient
    form: WoT.Form
}


export abstract class ConsumedThingInteraction {
    // export getClientFor
    label: string;
    forms: Array<WoT.Form>;
    links: Array<WoT.Link>;
    
    thingName: string;
    thingId: string;
    thingSecurity: any;
    clients: Map<string, ProtocolClient> = new Map();
    readonly srv: Servient;


    constructor(thingName: string, thingId: string, thingSecurity: any, clients: Map<string, ProtocolClient>, srv: Servient) {
        this.thingName = thingName;
        this.thingId = thingId;
        this.thingSecurity = thingSecurity;
        this.clients = clients;
        this.srv = srv;
    }

    // utility for Property, Action and Event
    getClientFor(forms: Array<TD.Form>): ClientAndForm {
        if (forms.length === 0) {
            throw new Error("ConsumedThing '${this.name}' has no links for this interaction");
        }

        let schemes = forms.map(link => Helpers.extractScheme(link.href))
        let cacheIdx = schemes.findIndex(scheme => this.clients.has(scheme))

        if (cacheIdx !== -1) {
            // from cache
            console.debug(`ConsumedThing '${this.thingName}' chose cached client for '${schemes[cacheIdx]}'`);
            let client = this.clients.get(schemes[cacheIdx]);
            let form = forms[cacheIdx];
            return { client: client, form: form };
        } else {
            // new client
            console.debug(`ConsumedThing '${this.thingName}' has no client in cache (${cacheIdx})`);
            let srvIdx = schemes.findIndex(scheme => this.srv.hasClientFor(scheme));
            if (srvIdx === -1) throw new Error(`ConsumedThing '${this.thingName}' missing ClientFactory for '${schemes}'`);
            let client = this.srv.getClientFor(schemes[srvIdx]);
            if (client) {
                console.log(`ConsumedThing '${this.thingName}' got new client for '${schemes[srvIdx]}'`);
                if (this.thingSecurity) {
                    console.warn("ConsumedThing applying security metadata");
                    //console.dir(this.security);
                    client.setSecurity(this.thingSecurity, this.srv.getCredentials(this.thingId));
                }
                this.clients.set(schemes[srvIdx], client);
                let form = forms[srvIdx];
                return { client: client, form: form }
            } else {
                throw new Error(`ConsumedThing '${this.thingName}' could not get client for '${schemes[srvIdx]}'`);
            }
        }
    }
}

export class ConsumedThingProperty extends ConsumedThingInteraction implements WoT.ThingProperty, WoT.DataSchema {
    writable: boolean;
    observable: boolean;
    value: any;
    type: WoT.DataType;

    // get and set interface for the Property
    get(): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            // get right client
            let { client, form } = this.getClientFor(this.forms);
            if (!client) {
                reject(new Error(`ConsumedThing '${this.thingName}' did not get suitable client for ${form.href}`));
            } else {
                console.log(`ConsumedThing '${this.thingName}' reading ${form.href}`);
                client.readResource(form).then((content) => {
                    if (!content.mediaType) content.mediaType = form.mediaType;
                    //console.log(`ConsumedThing decoding '${content.mediaType}' in readProperty`);
                    let value = ContentSerdes.contentToValue(content);
                    resolve(value);
                })
                    .catch(err => { console.log("Failed to read because " + err); });
            }

        });
    }
    set(value: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let { client, form } = this.getClientFor(this.forms);
            if (!client) {
                reject(new Error(`ConsumedThing '${this.thingName}' did not get suitable client for ${form.href}`));
            } else {
                console.log(`ConsumedThing '${this.thingName}' writing ${form.href} with '${value}'`);
                let content = ContentSerdes.valueToContent(value, form.mediaType)
                resolve(client.writeResource(form, content));

                // // TODO observables
                // if (this.observablesPropertyChange.get(propertyName)) {
                //     this.observablesPropertyChange.get(propertyName).next(newValue);
                // };
            }
        });
    }
}

export class ConsumedThingAction extends ConsumedThingInteraction implements WoT.ThingAction {
    run(parameter?: any): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let { client, form } = this.getClientFor(this.forms);
            if (!client) {
                reject(new Error(`ConsumedThing '${this.thingName}' did not get suitable client for ${form.href}`));
            } else {
                console.log(`ConsumedThing '${this.thingName}' invoking ${form.href} with '${parameter}'`);

                let mediaType = form.mediaType;
                let input = ContentSerdes.valueToContent(parameter, form.mediaType);

                client.invokeResource(form, input).then((output) => {
                    if (!output.mediaType) output.mediaType = form.mediaType;
                    //console.log(`ConsumedThing decoding '${output.mediaType}' in invokeAction`);
                    let value = ContentSerdes.contentToValue(output);
                    resolve(value);
                });
            }
        });
    }
}

export class ConsumedThingEvent extends ConsumedThingProperty implements WoT.ThingEvent {
}



export default class ConsumedThing extends TD.Thing implements WoT.ConsumedThing {

    protected readonly td: WoT.ThingDescription;
    protected thing: TD.Thing;

    protected readonly srv: Servient;
    protected clients: Map<string, ProtocolClient> = new Map();
    protected observablesEvent: Map<string, Subject<any>> = new Map();
    protected observablesPropertyChange: Map<string, Subject<any>> = new Map();
    protected observablesTDChange: Subject<any> = new Subject<any>();

    constructor(servient: Servient, td: WoT.ThingDescription) {
        super();
        this.srv = servient;
        // cache original TD
        this.td = td;

        // apply TD to Thing with normalized URIs (base resolved)
        this.thing = TD.parseTDString(td, true);
        console.log("Properties #: " + Object.keys(this.thing.properties).length);
        console.log("Actions    #: " + Object.keys(this.thing.actions).length);
        console.log("Events     #: " + Object.keys(this.thing.events).length);
        // console.log("TD as JSON: " + JSON.stringify(td));

        this.name = this.thing.name;
        this.id = this.thing.id;
        this.properties = {};
        // this.properties = this.thing.properties;
        if (this.thing.properties != undefined && this.thing.properties instanceof Object) {
            for (var name in this.thing.properties) {
                let prop = this.thing.properties[name];
                let p = new ConsumedThingProperty(this.thing.name, this.thing.id, this.thing.security, this.clients, this.srv);
                p.forms = prop.forms;
                this.properties[name] = p;
            }
        }
        this.actions = {};
        // this.actions = this.thing.actions;
        if (this.thing.actions != undefined && this.thing.actions instanceof Object) {
            for (var name in this.thing.actions) {
                let act = this.thing.actions[name];
                let a = new ConsumedThingAction(this.thing.name, this.thing.id, this.thing.security, this.clients, this.srv);
                a.forms = act.forms;
                this.actions[name] = a;
            }
        }
        this.events = {};
        // this.events = this.thing.events;
        if (this.thing.events != undefined && this.thing.events instanceof Object) {
            for (var name in this.thing.events) {
                let ev = this.thing.events[name];
                let e = new ConsumedThingEvent(this.thing.name, this.thing.id, this.thing.security, this.clients, this.srv);
                e.forms = ev.forms;
                this.events[name] = e;
            }
        }

        // TODO security
        this.security = this.thing.security;
        // TODO metadata
        this.links = this.thing.links;

        /*
        let tdObj = TD.parseTDString(td, true);
        this.context = tdObj.context;
        this.semanticType = tdObj.semanticType;
        this.name = tdObj.name;
        this.id = tdObj.id;
        if (Array.isArray(tdObj.security) && tdObj.security.length >= 1) {
            if (tdObj.security.length > 1) {
                console.warn(`ConsumedThing '${this.name}' received multiple security metadata entries, selecting first`)
            }
            this.security = tdObj.security[0];
        } else {
            this.security = tdObj.security;
        }
        this.metadata = tdObj.metadata;
        this.interaction = tdObj.interaction;
        this.link = tdObj.link;
        */
    }

    get(param: string): any {
        return this.thing[param];
    }

    /**
     * Returns the Thing Description of the Thing.
     */
    getThingDescription(): WoT.ThingDescription {
        // returning cached version
        return this.td;
    }

    // onPropertyChange(name: string): Observable<any> {
    //     if (!this.observablesPropertyChange.get(name)) {
    //         console.log("Create propertyChange observable for " + name);
    //         this.observablesPropertyChange.set(name, new Subject());
    //     }

    //     return this.observablesPropertyChange.get(name).asObservable();
    // }

    // onEvent(name: string): Observable<any> {
    //     if (!this.observablesEvent.get(name)) {
    //         console.log("Create event observable for " + name);
    //         this.observablesEvent.set(name, new Subject());
    //     }

    //     return this.observablesEvent.get(name).asObservable();
    // }

    // onTDChange(): Observable<any> {
    //     return this.observablesTDChange.asObservable();
    // }

}
