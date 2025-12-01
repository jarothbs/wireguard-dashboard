import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Copy, Download, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";

const ConfigGenerator = () => {
  const { toast } = useToast();
  const [clientID, setClientID] = useState("");
  const [clientIPSuffix, setClientIPSuffix] = useState("");
  const [lanNetwork, setLanNetwork] = useState("");
  const [dhcpStart, setDhcpStart] = useState("10");
  const [dhcpEnd, setDhcpEnd] = useState("100");
  const [dnsServers, setDnsServers] = useState("8.8.8.8,8.8.4.4");
  const [clientPubKey, setClientPubKey] = useState("");
  const [setupDNAT, setSetupDNAT] = useState(false);
  const [cameraType, setCameraType] = useState("Dahua");
  const [numCameras, setNumCameras] = useState(1);
  const [cameraIPs, setCameraIPs] = useState<string[]>([""]);
  const [generatedConfig, setGeneratedConfig] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [suggestedIP, setSuggestedIP] = useState<number | null>(null);
  const [suggestedLAN, setSuggestedLAN] = useState<string>("");
  const [suggestedMC, setSuggestedMC] = useState<number | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  useEffect(() => {
    const newCameraIPs = Array(numCameras).fill("").map((_, i) => cameraIPs[i] || "");
    setCameraIPs(newCameraIPs);
  }, [numCameras]);

  useEffect(() => {
    fetchSuggestion();
  }, []);

  const fetchSuggestion = async () => {
    setLoadingSuggestion(true);
    try {
      const { data, error } = await supabase.functions.invoke('mikrotik-fetch');
      
      if (error) throw error;
      
      if (data.success) {
        const usedMCs = new Set<number>();
        const usedWGIPs = new Set<number>();
        const usedLANs = new Set<string>();
        
        data.data.forEach((peer: any) => {
          // Extraer MC del nombre
          const name = peer.name || peer.comment || "";
          const mcMatch = name.match(/^(?:WIREGUARD-)?MC(\d+)(?:[_-]|$)/i);
          if (mcMatch) {
            usedMCs.add(parseInt(mcMatch[1]));
          }
          
          // Extraer IP WireGuard
          const wgIPMatch = peer["allowed-address"].match(/100\.100\.100\.(\d+)/);
          if (wgIPMatch) {
            usedWGIPs.add(parseInt(wgIPMatch[1]));
          }
          
          // Extraer LANs
          const lans = peer["allowed-address"]
            .split(',')
            .filter((addr: string) => !addr.includes('100.100.100') && !addr.includes('172.16.100'))
            .map((addr: string) => addr.trim());
          
          lans.forEach((lan: string) => usedLANs.add(lan));
        });

        // MCs estáticos y DDNS reservados
        const DDNS_RESERVED_MCS = [2, 7, 14, 20, 26, 46, 62, 66, 70];
        const STATIC_OVERRIDES = [5, 8, 19, 21, 22, 31, 38, 63];
        
        DDNS_RESERVED_MCS.forEach(mc => usedMCs.add(mc));
        STATIC_OVERRIDES.forEach(mc => usedMCs.add(mc));

        // Encontrar siguiente MC disponible (1-200)
        const nextMC = Array.from({ length: 200 }, (_, idx) => idx + 1)
          .find(mc => !usedMCs.has(mc)) || 1;

        // Encontrar siguiente IP WireGuard disponible
        const nextWGIP = Array.from({ length: 252 }, (_, idx) => idx + 2)
          .find(suffix => !usedWGIPs.has(suffix)) || 2;
        
        // Encontrar siguiente LAN disponible
        const nextLAN = Array.from({ length: 200 }, (_, idx) => `192.168.${idx + 10}`)
          .find(lan => !usedLANs.has(`${lan}.0/24`)) || "192.168.10";

        setSuggestedMC(nextMC);
        setSuggestedIP(nextWGIP);
        setSuggestedLAN(nextLAN);
      }
    } catch (error) {
      console.error('Error fetching suggestion:', error);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const applySuggestion = () => {
    if (suggestedMC) {
      setClientID(`MC${String(suggestedMC).padStart(2, '0')}`);
    }
    if (suggestedIP) {
      setClientIPSuffix(suggestedIP.toString());
    }
    if (suggestedLAN) {
      setLanNetwork(suggestedLAN);
    }
    toast({
      title: "Sugerencia aplicada",
      description: "Se han completado los campos con los valores sugeridos",
    });
  };

  const generateBaseConfig = () => {
    return `# ================================================================
# CONFIGURACION BASE PARA CLIENTE: ${clientID}
# IP WireGuard: 100.100.100.${clientIPSuffix}
# Red LAN: ${lanNetwork}.0/24
# ================================================================

# 1. CONFIGURACION BASICA DE RED
/interface bridge add name=LAN-Bridge comment="Red Local"
/interface bridge port add bridge=LAN-Bridge interface=ether2 comment="Puerto LAN"
/interface bridge port add bridge=LAN-Bridge interface=ether3 comment="Puerto LAN"
/interface bridge port add bridge=LAN-Bridge interface=ether4 comment="Puerto LAN"
/interface bridge port add bridge=LAN-Bridge interface=ether5 comment="Puerto LAN"

# 2. CONFIGURACION IP
/ip address add address=${lanNetwork}.1/24 interface=LAN-Bridge comment="IP Router"
/ip dhcp-client add interface=ether1 disabled=no comment="Internet"

# 3. CONFIGURACION DNS
/ip dns set servers=${dnsServers} allow-remote-requests=yes

# 4. CONFIGURACION DHCP
/ip pool add name=pool-lan ranges=${lanNetwork}.${dhcpStart}-${lanNetwork}.${dhcpEnd}
/ip dhcp-server add name=dhcp-lan interface=LAN-Bridge address-pool=pool-lan disabled=no
/ip dhcp-server network add address=${lanNetwork}.0/24 gateway=${lanNetwork}.1 dns-server=${dnsServers}

# 5. CONFIGURACION NAT
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="Internet NAT"

# 6. CAMBIAR CONTRASEÑA
/user set admin password="StS2021!!"
`;
  };

  const generateWireGuardConfig = () => {
    const allowedNetworks = `172.16.100.0/24,100.100.100.1/32,${lanNetwork}.0/24`;
    
    return `
# ================================================================
# CONFIGURACION WIREGUARD PARA CLIENTE: ${clientID}
# IP WireGuard: 100.100.100.${clientIPSuffix}
# ================================================================

/interface wireguard add name=WIREGUARD-${clientID} listen-port=13231 comment="WireGuard ${clientID}"
/ip address add address=100.100.100.${clientIPSuffix}/24 interface=WIREGUARD-${clientID} comment="WireGuard IP"
/interface wireguard peers add interface=WIREGUARD-${clientID} name=SERVER-${clientID} comment="Servidor ${clientID}" public-key="${clientPubKey}" endpoint-address="mikrotik-sts.cr-safe.com" endpoint-port=13231 allowed-address="${allowedNetworks}" persistent-keepalive=25s
/ip route add dst-address=172.16.100.0/24 gateway=100.100.100.1 comment="Ruta WireGuard"

/ip firewall filter add chain=forward in-interface=WIREGUARD-${clientID} out-interface=LAN-Bridge action=accept comment="WG->LAN ${clientID}"
/ip firewall filter add chain=forward in-interface=LAN-Bridge out-interface=WIREGUARD-${clientID} action=accept comment="LAN->WG ${clientID}"
/ip firewall filter add chain=forward src-address=172.16.100.0/24 in-interface=WIREGUARD-${clientID} out-interface=LAN-Bridge action=accept comment="Monitoreo->LAN ${clientID}"
`;
  };

  const generateDNATConfig = () => {
    if (!setupDNAT) return "";

    const portBase = 8000 + (parseInt(clientIPSuffix) * 10);
    let config = `
# ================================================================
# CONFIGURACION DNAT PARA CAMARAS ${cameraType}
# Cliente: ${clientID}
# Base de puertos: ${portBase}
# ================================================================
`;

    cameraIPs.forEach((ip, i) => {
      const cameraNum = i + 1;
      const httpPort = portBase + cameraNum;
      const rtspPort = portBase + cameraNum + 50;
      
      config += `
# Camara ${cameraNum} (${ip})
/ip firewall nat add chain=dstnat in-interface=WIREGUARD-${clientID} dst-address=100.100.100.${clientIPSuffix} protocol=tcp dst-port=${httpPort} action=dst-nat to-addresses=${ip} to-ports=80 comment="HTTP Cam${cameraNum} ${clientID}"
/ip firewall nat add chain=dstnat src-address=172.16.100.0/24 dst-address=100.100.100.${clientIPSuffix} protocol=tcp dst-port=${httpPort} action=dst-nat to-addresses=${ip} to-ports=80 comment="HTTP-MON Cam${cameraNum} ${clientID}"
/ip firewall nat add chain=dstnat in-interface=WIREGUARD-${clientID} dst-address=100.100.100.${clientIPSuffix} protocol=tcp dst-port=${rtspPort} action=dst-nat to-addresses=${ip} to-ports=554 comment="RTSP Cam${cameraNum} ${clientID}"
/ip firewall nat add chain=dstnat src-address=172.16.100.0/24 dst-address=100.100.100.${clientIPSuffix} protocol=tcp dst-port=${rtspPort} action=dst-nat to-addresses=${ip} to-ports=554 comment="RTSP-MON Cam${cameraNum} ${clientID}"
`;
    });

    return config;
  };

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();

    if (!clientID || !clientIPSuffix || !lanNetwork || !clientPubKey) {
      toast({
        title: "Error",
        description: "Por favor complete todos los campos requeridos",
        variant: "destructive",
      });
      return;
    }

    const config = generateBaseConfig() + generateWireGuardConfig() + generateDNATConfig();
    setGeneratedConfig(config);
    setShowResults(true);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedConfig);
    toast({
      title: "Copiado",
      description: "Configuración copiada al portapapeles",
    });
  };

  const downloadConfig = () => {
    const blob = new Blob([generatedConfig], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `config-${clientID}.rsc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generador de Configuración MikroTik</CardTitle>
        <CardDescription>WireGuard + DNAT + Watchdog Non-Intrusive</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleGenerate} className="space-y-6">
          {suggestedMC && suggestedIP && suggestedLAN && !loadingSuggestion && (
            <Alert className="bg-primary/5 border-primary/20">
              <Lightbulb className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Siguiente disponible: <strong>MC{String(suggestedMC).padStart(2, '0')}</strong>, <strong>IP 100.100.100.{suggestedIP}</strong> y <strong>LAN {suggestedLAN}.0/24</strong>
                </span>
                <Button type="button" size="sm" onClick={applySuggestion}>
                  Usar Sugerencia
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="clientID">ID del Cliente *</Label>
              <Input
                id="clientID"
                placeholder="Ej: MC30, MC47-MONTAIN"
                value={clientID}
                onChange={(e) => setClientID(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientIPSuffix">Sufijo IP WireGuard *</Label>
              <Input
                id="clientIPSuffix"
                type="number"
                placeholder="30"
                min="1"
                max="254"
                value={clientIPSuffix}
                onChange={(e) => setClientIPSuffix(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lanNetwork">Red LAN (3 primeros octetos) *</Label>
            <Input
              id="lanNetwork"
              placeholder="192.168.28"
              value={lanNetwork}
              onChange={(e) => setLanNetwork(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dhcpStart">IP Inicial DHCP</Label>
              <Input
                id="dhcpStart"
                type="number"
                value={dhcpStart}
                onChange={(e) => setDhcpStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dhcpEnd">IP Final DHCP</Label>
              <Input
                id="dhcpEnd"
                type="number"
                value={dhcpEnd}
                onChange={(e) => setDhcpEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dnsServers">Servidor DNS</Label>
            <Select value={dnsServers} onValueChange={setDnsServers}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="8.8.8.8,8.8.4.4">Google (8.8.8.8, 8.8.4.4)</SelectItem>
                <SelectItem value="1.1.1.1,1.0.0.1">Cloudflare (1.1.1.1, 1.0.0.1)</SelectItem>
                <SelectItem value="208.67.222.222,208.67.220.220">OpenDNS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientPubKey">Llave Pública del Cliente WireGuard *</Label>
            <Textarea
              id="clientPubKey"
              placeholder="Pegar la public key generada en el MikroTik"
              value={clientPubKey}
              onChange={(e) => setClientPubKey(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="setupDNAT"
              checked={setupDNAT}
              onCheckedChange={(checked) => setSetupDNAT(checked as boolean)}
            />
            <Label htmlFor="setupDNAT" className="cursor-pointer">
              Configurar DNAT para cámaras IP
            </Label>
          </div>

          {setupDNAT && (
            <div className="space-y-4 p-4 border rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="cameraType">Tipo de Cámaras</Label>
                <Select value={cameraType} onValueChange={setCameraType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Dahua">Dahua</SelectItem>
                    <SelectItem value="Hikvision">Hikvision</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="numCameras">Número de Cámaras</Label>
                <Input
                  id="numCameras"
                  type="number"
                  min="1"
                  max="20"
                  value={numCameras}
                  onChange={(e) => setNumCameras(parseInt(e.target.value) || 1)}
                />
              </div>

              <div className="space-y-2">
                <Label>IPs de las Cámaras</Label>
                {cameraIPs.map((ip, index) => (
                  <Input
                    key={index}
                    placeholder={`IP Cámara ${index + 1}`}
                    value={ip}
                    onChange={(e) => {
                      const newIPs = [...cameraIPs];
                      newIPs[index] = e.target.value;
                      setCameraIPs(newIPs);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full">
            Generar Configuración
          </Button>
        </form>

        {showResults && (
          <div className="mt-6 space-y-4">
            <div className="flex gap-2">
              <Button onClick={copyToClipboard} variant="outline" className="gap-2">
                <Copy className="h-4 w-4" />
                Copiar
              </Button>
              <Button onClick={downloadConfig} variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Descargar .rsc
              </Button>
            </div>
            <Textarea
              value={generatedConfig}
              readOnly
              className="font-mono text-sm h-96"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ConfigGenerator;
