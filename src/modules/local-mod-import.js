"use strict";

// Local imports use an isolated snapshot. Nothing in the game profile is
// replaced until every archive entry and every mod definition has passed.
const fs = require("fs-extra");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const {Transform} = require("stream");
const {pipeline} = require("stream/promises");
const LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const LIMIT_FILES = 20000;
const LIMIT_DEFINITION_BYTES = 4 * 1024 * 1024;

class ImportError extends Error {
	constructor(code, message) {super(message); this.code = code;}
}
const fail = (code, message) => {throw new ImportError(code, message);};
const messages = {
	format: "不是可导入的北极星模组。请选择包含 mod.json 的 ZIP 压缩包或完整模组文件夹。",
	skin: "这是皮肤资源，不是北极星模组。DDS 或 VTF 皮肤请到对应的安装页面导入。",
	missing: "文件或文件夹不存在，请重新选择。",
	definition: "mod.json 无效：需要 JSON 对象和非空的 Name，Version 如有填写必须是文本。",
	zip: "ZIP 压缩包损坏或格式不受支持，请重新下载或解压后选择完整模组文件夹。",
	unsafe: "模组包含不安全或重复的文件路径，无法导入。",
	limit: "模组超过导入限制（2 GB 或 20000 个文件）。",
	duplicate: "压缩包中存在重复的模组名称，请拆分后分别导入。",
	game: "请先选择已安装北极星的 Titanfall 2 游戏目录。"
};
const badPath = component => !component || component === "." || component === ".." || /[<>:"|?*\u0000-\u001f]/u.test(component) || /[. ]$/u.test(component) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component);
function partsOf(value) {
	if (typeof value !== "string" || /^[\/]/u.test(value)) fail("unsafe", messages.unsafe);
	const parts = value.replace(/\\/g,"/").replace(/\/$/u,"").split("/");
	if (parts.some(badPath)) fail("unsafe", messages.unsafe);
	return parts;
}
function inside(root, destination) {
	const relative = path.relative(root, destination);
	return relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}
function regular(file, directory = false) {
	const stat = fs.lstatSync(file);
	if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) fail("unsafe", messages.unsafe);
	return stat;
}
function readDefinitionJson(file, comments = true) {
	if(regular(file).size>LIMIT_DEFINITION_BYTES) fail("definition",messages.definition);
	const bytes=fs.readFileSync(file), decoded=bytes.toString("utf8");
	if(!Buffer.from(decoded,"utf8").equals(bytes)) fail("definition","模组定义必须是有效的 UTF-8 文本，请重新下载或保存后再导入。");
	let text=decoded.replace(/^\uFEFF/u,""), clean="", quoted=false, escaped=false;
	if(comments) {
		for(let i=0;i<text.length;i++) {
			const char=text[i];
			if(quoted) {clean+=char;if(escaped) escaped=false;else if(char==="\\") escaped=true;else if(char==='"') quoted=false;continue;}
			if(char==='"') {quoted=true;clean+=char;continue;}
			if(char==="/" && text[i+1]==="/") {while(i+1<text.length && !/[\r\n]/u.test(text[i+1])) i++;clean+=" ";continue;}
			if(char==="/" && text[i+1]==="*") {
				const end=text.indexOf("*/",i+2);
				if(end<0) fail("definition",messages.definition);
				clean+=" ";i=end+1;continue;
			}
			clean+=char;
		}
		text=clean;clean="";quoted=false;escaped=false;
		for(let i=0;i<text.length;i++) {
			const char=text[i];
			if(quoted) {clean+=char;if(escaped) escaped=false;else if(char==="\\") escaped=true;else if(char==='"') quoted=false;continue;}
			if(char==='"') quoted=true;
			if(char===",") {let next=i+1;while(next<text.length && /\s/u.test(text[next])) next++;if(text[next]==="}" || text[next]==="]") continue;}
			clean+=char;
		}
		text=clean;
	}
	try {return JSON.parse(text);} catch(_) {fail("definition",messages.definition);}
}
async function readAt(handle, offset, length) {
	const data = Buffer.alloc(length);
	let done = 0;
	while (done < length) {
		const result = await handle.read(data,done,length-done,offset+done);
		if (!result.bytesRead) fail("zip",messages.zip);
		done += result.bytesRead;
	}
	return data;
}
const crcTable = Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++) n=(n&1)?0xedb88320^(n>>>1):n>>>1; return n>>>0;});
function crcValue(bytes) {
	let crc=0xffffffff;
	for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8);
	return (crc^0xffffffff)>>>0;
}
function decodeZipName(bytes, flags, extra) {
	// Windows-created Chinese archives often omit the UTF-8 flag. Honor the
	// Unicode path extra field first, then accept UTF-8 or legacy GB18030.
	for(let offset=0;offset<extra.length;) {
		if(offset+4>extra.length) fail("zip",messages.zip);
		const type=extra.readUInt16LE(offset), length=extra.readUInt16LE(offset+2), end=offset+4+length;
		if(end>extra.length) fail("zip",messages.zip);
		if(type===0x7075 && length>=5 && extra[offset+4]===1 && extra.readUInt32LE(offset+5)===crcValue(bytes)) {
			try {return new TextDecoder("utf-8",{fatal:true}).decode(extra.subarray(offset+9,end));} catch(_) {fail("zip",messages.zip);}
		}
		offset=end;
	}
	try {return new TextDecoder("utf-8",{fatal:true}).decode(bytes);} catch(_) {}
	if(flags&0x800) fail("zip",messages.zip);
	try {return new TextDecoder("gb18030",{fatal:true}).decode(bytes);} catch(_) {fail("zip",messages.zip);}
}
async function extractZip(source, destination, {include = () => true, maxBytes = LIMIT_BYTES, maxFiles = LIMIT_FILES} = {}) {
	const handle = await fs.promises.open(source,"r");
	try {
		const stat = await handle.stat();
		if (stat.size < 22 || stat.size > LIMIT_BYTES) fail(stat.size > LIMIT_BYTES ? "limit" : "zip", stat.size > LIMIT_BYTES ? messages.limit : messages.zip);
		const tailStart = Math.max(0,stat.size-65557), tail = await readAt(handle,tailStart,stat.size-tailStart);
		let end = -1;
		for(let i=tail.length-22;i>=0;i--) if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length) {end=i;break;}
		if(end < 0) fail("zip",messages.zip);
		const count=tail.readUInt16LE(end+10), centralSize=tail.readUInt32LE(end+12), centralOffset=tail.readUInt32LE(end+16);
		if(tail.readUInt16LE(end+4) || tail.readUInt16LE(end+6) || tail.readUInt16LE(end+8)!==count || count===0xffff || centralSize===0xffffffff || centralOffset+centralSize!==tailStart+end) fail("zip",messages.zip);
		if(count>LIMIT_FILES || centralSize>32*1024*1024) fail("limit",messages.limit);
		const central=await readAt(handle,centralOffset,centralSize), entries=[], paths=new Map();
		let offset=0,total=0,selectedBytes=0,selectedFiles=0;
		for(let i=0;i<count;i++) {
			if(offset+46>central.length || central.readUInt32LE(offset)!==0x02014b50) fail("zip",messages.zip);
			const flags=central.readUInt16LE(offset+8), method=central.readUInt16LE(offset+10), crc=central.readUInt32LE(offset+16), compressed=central.readUInt32LE(offset+20), size=central.readUInt32LE(offset+24), nameLength=central.readUInt16LE(offset+28), extraLength=central.readUInt16LE(offset+30), commentLength=central.readUInt16LE(offset+32), external=central.readUInt32LE(offset+38), local=central.readUInt32LE(offset+42);
			const next=offset+46+nameLength+extraLength+commentLength;
			if(next>central.length || flags&1 || ![0,8].includes(method) || size===0xffffffff || compressed===0xffffffff || local>=centralOffset) fail("zip",messages.zip);
			const nameBytes=central.subarray(offset+46,offset+46+nameLength), name=decodeZipName(nameBytes,flags,central.subarray(offset+46+nameLength,offset+46+nameLength+extraLength));
			const parts=partsOf(name), directory=/[\/]$/u.test(name), key=parts.join("/").toLowerCase();
			if(paths.has(key) || (external>>>16&0xf000)===0xa000) fail("unsafe",messages.unsafe);
			paths.set(key,directory);
			if((total+=size)>LIMIT_BYTES) fail("limit",messages.limit);
			const selected=!directory&&include(parts.join('/'));
			if(selected&&((selectedBytes+=size)>maxBytes||++selectedFiles>maxFiles))fail('limit',messages.limit);
			entries.push({parts,nameBytes,directory,flags,method,crc,compressed,size,local,selected});
			offset=next;
		}
		if(offset!==central.length) fail("zip",messages.zip);
		for(const entry of entries) for(let i=1;i<entry.parts.length;i++) if(paths.get(entry.parts.slice(0,i).join("/").toLowerCase())===false) fail("unsafe",messages.unsafe);
		for(const entry of entries) {
			if(!entry.selected)continue;
			const header=await readAt(handle,entry.local,30);
			if(header.readUInt32LE(0)!==0x04034b50 || header.readUInt16LE(6)!==entry.flags || header.readUInt16LE(8)!==entry.method) fail("zip",messages.zip);
			const nameLength=header.readUInt16LE(26), start=entry.local+30+nameLength+header.readUInt16LE(28);
			if(start+entry.compressed>centralOffset || !entry.nameBytes.equals(await readAt(handle,entry.local+30,nameLength))) fail("zip",messages.zip);
			const target=path.join(destination,...entry.parts);
			if(!inside(destination,target)) fail("unsafe",messages.unsafe);
			if(entry.directory) {await fs.ensureDir(target);continue;}
			await fs.ensureDir(path.dirname(target));
			let length=0,crc=0xffffffff;
			const verify=new Transform({transform(chunk,_encoding,callback){
				length+=chunk.length;
				if(length>entry.size) {callback(new ImportError("zip",messages.zip));return;}
				for(const byte of chunk) crc=crcTable[(crc^byte)&255]^(crc>>>8);
				callback(null,chunk);
			}});
			if(!entry.compressed) {
				if(entry.size || entry.crc) fail("zip",messages.zip);
				await fs.writeFile(target,Buffer.alloc(0),{flag:"wx"});
			} else {
				const streams=[fs.createReadStream(source,{start,end:start+entry.compressed-1})];
				if(entry.method===8) streams.push(zlib.createInflateRaw());
				streams.push(verify,fs.createWriteStream(target,{flags:"wx"}));
				try {await pipeline(...streams);} catch(error) {if(error instanceof ImportError) throw error; fail("zip",messages.zip);}
				if(length!==entry.size || ((crc^0xffffffff)>>>0)!==entry.crc) fail("zip",messages.zip);
			}
		}
	} finally {await handle.close();}
}
async function scanTree(root) {
	const definitions=[],textures=[];
	let count=0,bytes=0;
	async function visit(directory,depth) {
		if(depth>32) fail("limit",messages.limit);
		const names=new Set();
		for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
			partsOf(entry.name);
			const key=entry.name.toLowerCase();
			if(names.has(key)) fail("unsafe",messages.unsafe);
			names.add(key);
			const file=path.join(directory,entry.name), stat=fs.lstatSync(file);
			if(stat.isSymbolicLink()) fail("unsafe",messages.unsafe);
			if(stat.isDirectory()) await visit(file,depth+1);
			else if(stat.isFile()) {
				if(++count>LIMIT_FILES || (bytes+=stat.size)>LIMIT_BYTES) fail("limit",messages.limit);
				if(key==="mod.json") definitions.push(file);
				if(/\.(dds|vtf)$/iu.test(key)) textures.push(file);
			} else fail("unsafe",messages.unsafe);
		}
	}
	await visit(root,0);
	return {definitions,textures};
}
function treeDigest(root) {
  regular(root,true);const digest=crypto.createHash('sha256');let count=0,total=0;
  function visit(directory,relative,depth){
    if(depth>32)fail('limit',messages.limit);
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=path.join(directory,entry.name),key=relative?relative+'/'+entry.name:entry.name,stat=fs.lstatSync(file);
      partsOf(entry.name);if(stat.isSymbolicLink())fail('unsafe',messages.unsafe);
      digest.update(JSON.stringify([key,stat.isDirectory()?'directory':'file'])+'\n');
      if(stat.isDirectory())visit(file,key,depth+1);
      else if(stat.isFile()){
        if(++count>LIMIT_FILES||(total+=stat.size)>LIMIT_BYTES)fail('limit',messages.limit);
        const fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(64*1024);let offset=0;
        try{const before=fs.fstatSync(fd);if(before.dev!==stat.dev||before.ino!==stat.ino||before.size!==stat.size)fail('unsafe',messages.unsafe);while(offset<before.size){const read=fs.readSync(fd,buffer,0,Math.min(buffer.length,before.size-offset),offset);if(!read)fail('unsafe',messages.unsafe);digest.update(buffer.subarray(0,read));offset+=read;}const after=fs.fstatSync(fd);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)fail('unsafe',messages.unsafe);}finally{fs.closeSync(fd);}
      }else fail('unsafe',messages.unsafe);
    }
  }
  visit(root,'',0);return digest.digest('hex');
}
function modDefinition(file) {
	const data=readDefinitionJson(file);
	if(!data || Array.isArray(data) || typeof data.Name!=="string" || !data.Name.trim() || /[\u0000-\u001f]/u.test(data.Name) || ("Version" in data && (typeof data.Version!=="string" || !data.Version.trim()))) fail("definition",messages.definition);
	for(const key of ["Description","DownloadLink"]) if(key in data && typeof data[key]!=="string") fail("definition",messages.definition);
	if(("RequiredOnClient" in data && typeof data.RequiredOnClient!=="boolean") || ("LoadPriority" in data && (!Number.isInteger(data.LoadPriority) || data.LoadPriority < -2147483648 || data.LoadPriority > 2147483647))) fail("definition",messages.definition);
	return data;
}
function findManifest(directory,root) {
	while(true) {
		const file=path.join(directory,"manifest.json");
		if(fs.existsSync(file)) {
			const data=readDefinitionJson(file,false);
			if(!data || Array.isArray(data) || typeof data.name!=="string" || !data.name.trim()) fail("definition","manifest.json 无效：需要有效的模组包名称。");
			return {file,data};
		}
		if(directory===root) return null;
		directory=path.dirname(directory);
	}
}
async function importLocalMod(source, options={}) {
	if(typeof source!=="string" || !path.isAbsolute(source) || !fs.existsSync(source)) fail("missing",messages.missing);
	const sourceStat=fs.lstatSync(source);
	if(sourceStat.isSymbolicLink()) fail("unsafe",messages.unsafe);
	if(!sourceStat.isDirectory() && (!sourceStat.isFile() || !/\.zip$/iu.test(source))) fail(/\.(dds|vtf)$/iu.test(source)?"skin":"format",/\.(dds|vtf)$/iu.test(source)?messages.skin:messages.format);
	const gamePath=options.gamePath;
	if(typeof gamePath!=="string" || !path.isAbsolute(gamePath) || !fs.existsSync(path.join(gamePath,"NorthstarLauncher.exe"))) fail("game",messages.game);
	const profile=options.profileDirectory||path.join(gamePath,"R2Northstar");
	if(!path.isAbsolute(profile) || (path.resolve(profile)!==path.resolve(gamePath) && !inside(path.resolve(gamePath),path.resolve(profile)))) fail("game",messages.game);
	const destinationRoot=path.join(profile,"mods");
	function checkDestinationPaths() {
		let component=path.resolve(gamePath);regular(component,true);
		for(const part of path.relative(component,destinationRoot).split(path.sep).filter(Boolean)){component=path.join(component,part);if(fs.existsSync(component)) regular(component,true);}
		if(transaction && fs.existsSync(transaction)) regular(transaction,true);
	}
	await fs.ensureDir(options.cacheRoot);
	const work=await fs.mkdtemp(path.join(options.cacheRoot,"import-")), snapshot=path.join(work,"source");
	let transaction=null, keepTransaction=false;
	try {
		await fs.ensureDir(snapshot);
		if(sourceStat.isDirectory()) {
			await scanTree(source);
			await fs.copy(source,snapshot,{dereference:false,errorOnExist:true,overwrite:false});
		} else await extractZip(source,snapshot);
		const scan=await scanTree(snapshot);
		if(!scan.definitions.length) fail(scan.textures.length?"skin":"format",scan.textures.length?messages.skin:messages.format);
		if(scan.definitions.length>128) fail("limit",messages.limit);
		const plan=[],names=new Set(),destinations=new Set();
		for(const file of scan.definitions) {
			const definition=modDefinition(file), directory=path.dirname(file);
			if(["Northstar.Client","Northstar.Custom","Northstar.CustomServers"].some(name=>name.toLowerCase()===definition.Name.toLowerCase())) fail("definition","北极星核心组件请通过客户端安装或修复，不能作为外部模组覆盖。");
			if(scan.definitions.some(other=>other!==file && inside(directory,path.dirname(other)))) fail("definition","模组文件夹内嵌套了另一个 mod.json，请将模组拆分为独立文件夹后导入。");
			if(names.has(definition.Name.toLowerCase())) fail("duplicate",messages.duplicate);
			names.add(definition.Name.toLowerCase());
			const manifest=findManifest(directory,snapshot);
			let folder=directory===snapshot ? (sourceStat.isDirectory()?path.basename(source):path.basename(source,path.extname(source))) : path.basename(directory);
			if(directory===snapshot || folder.toLowerCase()==="mods") folder=options.destname || (manifest && manifest.data.name) || folder;
			if(["Northstar.Client","Northstar.Custom","Northstar.CustomServers"].some(name=>name.toLowerCase()===folder.toLowerCase())) fail("definition","模组目标目录与北极星核心组件重名，无法导入。");
			partsOf(folder);
			if(folder.includes("/") || folder.includes("\\")) fail("unsafe",messages.unsafe);
			let candidate=folder,number=2;
			while(destinations.has(candidate.toLowerCase())) candidate=folder+" ("+(number++)+")";
			destinations.add(candidate.toLowerCase());
			plan.push({directory,folder:candidate,definition,manifest});
		}
		// Check every destination before creating a staging directory in the game.
		await options.guard?.();
		checkDestinationPaths();
		for(const item of plan) {
			item.target=path.join(destinationRoot,item.folder);
			if(!inside(destinationRoot,item.target)) fail("unsafe",messages.unsafe);
			if(fs.existsSync(item.target)) regular(item.target,true);
			item.baseline=fs.existsSync(item.target)?treeDigest(item.target):null;
		}
		await fs.ensureDir(destinationRoot);
		await options.guard?.();
		checkDestinationPaths();
		transaction=await fs.mkdtemp(path.join(destinationRoot,".vyra-import-"));
		const committed=[];
		try {
			for(let i=0;i<plan.length;i++) {
				checkDestinationPaths();
				const item=plan[i];
				item.staged=path.join(transaction,"new-"+i); item.backup=path.join(transaction,"old-"+i);
				await fs.copy(item.directory,item.staged,{errorOnExist:true,overwrite:false});
				checkDestinationPaths();regular(item.staged,true);
				if(item.manifest) await fs.copy(item.manifest.file,path.join(item.staged,"manifest.json"));
				if(options.author) await fs.writeFile(path.join(item.staged,"thunderstore_author.txt"),String(options.author),"utf8");
				item.stagedDigest=treeDigest(item.staged);
			}
			for(const item of plan) {
				await options.guard?.();
				checkDestinationPaths();regular(item.staged,true);
				if(fs.existsSync(item.target)) regular(item.target,true);
				if((fs.existsSync(item.target)?treeDigest(item.target):null)!==item.baseline)fail('conflict',"已安装的模组已被其他程序修改，请刷新后重试。未覆盖当前文件。");
				if(fs.existsSync(item.target)) {await fs.rename(item.target,item.backup);item.previous=true;}
				committed.push(item);
				await fs.rename(item.staged,item.target);
			}
		} catch(error) {
			try {
				checkDestinationPaths();
				for(const item of committed.reverse()) {
					if(item.previous&&fs.existsSync(item.backup)&&treeDigest(item.backup)!==item.baseline)fail('conflict',"已安装的模组已被其他程序修改，请刷新后重试。未覆盖当前文件。");
					if(fs.existsSync(item.target)) {if(treeDigest(item.target)!==item.stagedDigest)fail('conflict',"已安装的模组已被其他程序修改，请刷新后重试。未覆盖当前文件。");await fs.remove(item.target);}
					if(item.previous && fs.existsSync(item.backup)) await fs.rename(item.backup,item.target);
				}
			} catch(restoreError) {
				keepTransaction=true;
				throw new ImportError("recovery", "导入未完成；旧模组恢复失败，备份已保留在："+transaction+"。"+restoreError.message);
			}
			throw error;
		}
		return {ok:true,name:plan.length===1?plan[0].definition.Name:path.basename(source,path.extname(source)),names:plan.map(item=>item.definition.Name),modCount:plan.length,malformed:false};
	} finally {
		// A cache cleanup failure must not turn a committed installation into a
		// false failure. Each later import still receives a fresh directory.
		if(transaction && !keepTransaction) {try {checkDestinationPaths();await fs.remove(transaction);} catch(_) {}}
		try {await fs.remove(work);} catch(_) {}
	}
}

module.exports = {importLocalMod,ImportError,messages,extractZip,scanTree,modDefinition};
